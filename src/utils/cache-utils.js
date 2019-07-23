import flatten from 'lodash/flatten';
import stableStringify from 'json-stable-stringify';
import { arrayify, unrole } from '@scipe/jsonld';
import { getScopeId, getDbName, getRootPart } from '@scipe/librarian';

export function cache(
  req,
  getPayload, // a function(callback) that calls `callback` with (err, data)
  opts,
  callback
) {
  if (!callback) {
    callback = opts;
    opts = {};
  }
  opts = opts || {};

  const {
    bare = false, // if `true` we return JS object instead of a string. This is false by default as redis returns strings
    lifeSpan = 24 * 60 * 60, // 24 hours (`lifeSpan` is defined in seconds)
    prefix = 'bare'
  } = opts;

  const config = req.app.locals.config;

  const cacheConfig = String(config.cache) === 'true';

  const { librarian: { redis } = {} } = req;
  if (!redis || !cacheConfig) {
    return getPayload((err, data) => {
      if (err) {
        return callback(err);
      }

      if (bare) {
        return callback(null, data);
      }

      let stringifiedData;
      try {
        stringifiedData = JSON.stringify(data);
      } catch (err) {
        // can fail due to circular references for instance
        req.log.error(
          { err, url: req.originalUrl },
          'Could not stringify data'
        );
        return callback(err);
      }

      callback(null, stringifiedData);
    });
  }

  // if the user is logged in we serve user specific cache
  // this is because with options such as hydrate, potentialActions etc.
  // librarian return acl specific payloads
  let cacheKey = `${getDbName(config)}:cache:payload:${prefix}:${
    req.session && req.session.username ? `${req.session.username}:` : ''
  }${req.originalUrl
    .replace(/&?(cache=true|cache=false|cache=)/, '')
    .replace(/\?&/, '?')}`; // be sure the remove the `cache` qs from the cacheKey

  if (req.method === 'POST' && req.body && Object.keys(req.body).length) {
    // TODO take md5 if too long ?
    cacheKey += `:${stableStringify(req.body)}`;
  }

  redis.get(cacheKey, (err, payload) => {
    // if user called the API with cache = false, we don't return from the cache but still generate it for the next call)
    if (!err && payload && req.query.cache != false) {
      // return from cache
      return callback(null, bare ? JSON.parse(payload) : payload);
    }

    if (err) {
      if (req.log) {
        req.log.error(
          { err, cacheKey },
          `error getting cache value for search graph`
        );
      } else {
        console.error(err);
      }
    }

    getPayload((err, data) => {
      if (err) {
        return callback(err);
      }

      let stringifiedData;
      try {
        stringifiedData = JSON.stringify(data);
      } catch (err) {
        // can fail due to circular references for instance
        req.log.error(
          { err, url: req.originalUrl },
          'Could not stringify data'
        );
        return callback(err);
      }

      // we callback ASAP
      callback(null, bare ? data : stringifiedData);

      // Cache

      // We get the scopeIds so that we can do cache invalidation (see `uncache` method).
      const scopeIds = getCacheableScopeIds(data);

      redis
        .multi([
          // cached payload (auto expires after `lifeSpan`)
          ['setex', cacheKey, lifeSpan, stringifiedData],
          // auto expiring set to keep track of what cacheKey are related to a scopeId so that we can do cache invalidation based on scopes later
          // the set of cache keys by scopeId (needed for cache invalidation)
          ...scopeIds.map(scopeId => {
            return [
              'sadd',
              `${getDbName(config)}:cache:keys:${scopeId}`,
              cacheKey
            ];
          }),
          // make the set auto expire after lifeSpan + 1
          ...scopeIds.map(scopeId => {
            return [
              'expire',
              `${getDbName(config)}:cache:keys:${scopeId}`,
              lifeSpan + 1
            ];
          })
        ])
        .exec((err, replies) => {
          if (err) {
            if (req.log) {
              req.log.error({ err, cacheKey }, `error caching search graphs`);
            } else {
              console.error(err);
            }
          }
        });
    });
  });
}

/**
 * Call on librarian.post and DELETE
 *
 * Note that the app-suite has some logic in the dashboard to shortcut the
 * cache in case of the app-suite got a change via the changes feed triggering a fetch.
 * That fetch could happen _before_ the cache was invalidated here (given that
 * we invalidate the cache _after_ librarian.post completed meaning that the
 * replication could have happen before the API returned)
 */
export function uncache(
  req,
  data, // either the *result* of librarian.post (it must be the result so that
  // it has an _id from wich we can infer the scopeId) or an ItemList returned by
  // librarian.delete.
  callback
) {
  const config = req.app.locals.config;
  const cacheConfig = String(config.cache) === 'true';

  const scopeIds = getCacheableScopeIds(data);

  const { librarian: { redis } = {} } = req;

  if (!redis || !cacheConfig || !scopeIds.length) {
    return callback(null);
  }

  redis
    .multi(
      scopeIds.map(scopeId => {
        return ['smembers', `${getDbName(config)}:cache:keys:${scopeId}`];
      })
    )
    .exec((err, replies) => {
      if (err) {
        return callback(err);
      }

      const keys = Array.from(new Set(flatten(replies)));
      if (!keys.length) {
        return callback(null);
      }

      // delete the cached payload (cache:payload:<key>) + update the cache:keys:<scopeId> set
      redis
        .multi([
          ...keys.map(key => {
            return ['del', key];
          }),
          // Note: we remove entries from the set instead of deleting it in case new entries
          // where added in between the smembers call and the delete. The set will
          // autoexpire so we don't have to worry about leaking memory
          ...scopeIds.map(scopeId => {
            return [
              'srem',
              `${getDbName(config)}:cache:keys:${scopeId}`,
              ...keys
            ];
          })
        ])
        .exec((err, replies) => {
          if (err) {
            return callback(err);
          }
        });
    });
}

function getCacheableScopeIds(
  data // a document, result of search result or delete itemlist
) {
  const scopeIds = new Set();

  const docs = arrayify(data)
    .concat(
      // search results
      arrayify(
        data.mainEntity ? data.mainEntity.itemListElement : data.itemListElement
      ).map(itemListElement => itemListElement.item),
      // hydrated search result
      arrayify(data['@graph'])
    )
    .filter(Boolean);

  docs.forEach(doc => {
    const scopeId = getScopeId(doc);
    if (
      scopeId &&
      (scopeId.startsWith('org:') ||
        scopeId.startsWith('journal:') ||
        scopeId.startsWith('graph:'))
    ) {
      scopeIds.add(scopeId);
    }

    // we also try to grab some scope from some of the key properties of action and graphs
    [
      'result',
      'object',
      'instrument',
      'publisher' // give the org
    ].forEach(p => {
      arrayify(doc[p]).forEach(value => {
        value = unrole(value, p);

        // We do it recursively as for CreateGraphAction for instance we will find the journal and org in the result value
        getCacheableScopeIds(value).forEach(scopeId => {
          scopeIds.add(scopeId);
        });
      });
    });

    // grab periodical from a graph
    if (doc.isPartOf) {
      const rootPart = getRootPart(doc);
      if (rootPart) {
        getCacheableScopeIds(rootPart).forEach(scopeId => {
          scopeIds.add(scopeId);
        });
      }
    }
  });

  return Array.from(scopeIds);
}
