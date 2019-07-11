import request from 'request';
import omit from 'lodash/omit';
import asyncMapSeries from 'async/mapSeries';
import {
  getBaseUrl,
  getDbName,
  Librarian,
  parseAuthorization,
  Store
} from '@scipe/librarian';
import createError from '@scipe/create-error';

/**
 * CouchDB reverse proxy
 *
 * The proxy won't proxy if there is a `dbVersion` mismatch. It allows to
 * deploy new version of the data model and prevent old documents living
 * in an old PouchDB that is connected to sci.pe (but with outdated
 * code of the sci.pe platform) to make it back to the updated
 * CouchDB.
 */
export default function createProxy(config = {}) {
  const DB_VERSION =
    typeof config.dbVersion === 'string' ? config.dbVersion : '';
  const root = getBaseUrl(config).replace(/\/$/, '');
  const token = `__${DB_VERSION}__`;

  const re = /__([A-Za-z0-9\-\.]*)__/;

  const librarian = new Librarian(config);
  const dbPath = `/${getDbName(config)}__${DB_VERSION}__`;

  function proxy(req, res, next) {
    if (!req.headers['x-pouchdb']) {
      return next();
    }

    const url = `${root}${req.url.replace(token, '')}`;
    const pathname = req.url.replace(dbPath, '');

    // Request to CouchDB root (not a specific db)
    if (!req.url.startsWith(dbPath)) {
      return req
        .pipe(
          request({
            method: req.method,
            url
          })
        )
        .on('error', err => {
          if (req.log) {
            req.log.error({ err }, 'CouchDB reverse proxy');
          } else {
            console.error(err);
          }
        })
        .pipe(res);
    }

    // Requests specific to a DB
    const match = req.url.match(re);
    if (!match) {
      return next(createError(400, 'CouchDB reverse proxy: invalid URL'));
    }

    if (match[1] != DB_VERSION) {
      return next(
        createError(
          400,
          `CouchDB reverse proxy: non matching DB_VERSION (${DB_VERSION} / ${
            match[1]
          })`
        )
      );
    }

    const {
      username = req.session && req.session.username
    } = parseAuthorization(req);

    if (!username) {
      return next(createError(401, 'Need to login'));
    }

    // NOTE: auth is typically done with Cookie auth (the Headers are passed down with req.pipe)
    // simple case, we just reverse proxy
    if (
      !config.anonymize ||
      // we only load the response when we know it can includes documents
      // see http://docs.couchdb.org/en/stable/replication/protocol.html
      pathname === '/' ||
      pathname.startsWith('/_local') ||
      pathname.startsWith('/_revs_diff') ||
      pathname.startsWith('/_ensure_full_commit') ||
      (pathname.startsWith('/_changes') &&
        !pathname.includes('include_docs=true'))
    ) {
      return req
        .pipe(
          request({
            method: req.method,
            url
          })
        )
        .on('error', err => {
          if (req.log) {
            req.log.error({ err }, 'CouchDB reverse proxy');
          } else {
            console.error(err);
          }
        })
        .pipe(res);
    } else {
      // anonymize case:
      // We anonymize the response (CouchDB -> PouchDB)
      req
        .pipe(
          request(
            { url, gzip: true, method: req.method },
            (err, resp, body) => {
              if (err) return next(err);

              res.status(resp.statusCode);

              if (resp.statusCode === 200 && isJSON(resp)) {
                Object.keys(cleanHeaders(resp.headers)).forEach(k =>
                  res.setHeader(k, resp.headers[k])
                );

                if (typeof body === 'string' || body instanceof Buffer) {
                  try {
                    body = JSON.parse(body);
                  } catch (err) {
                    return next(createError(400, err));
                  }
                }

                handleAnonymize(
                  librarian,
                  username,
                  body,
                  (err, anonymizedBody) => {
                    if (err) return next(createError(400, err));
                    res.json(anonymizedBody);
                  }
                );
              } else {
                Object.keys(resp.headers).forEach(k =>
                  res.setHeader(k, resp.headers[k])
                );
                res.send(body);
              }
            }
          )
        )
        .on('error', err => {
          if (req.log) {
            req.log.error({ err }, 'CouchDB reverse proxy error');
          } else {
            console.error(err);
          }
        });
    }
  }

  proxy.librarian = librarian; // return librarian so it can be closed

  return proxy;
}

function isJSON(req) {
  let type = req && req.headers && req.headers['content-type'];
  if (!type) {
    return false;
  }

  type = type.toLowerCase().replace(/;.*/, '');
  if (type === 'application/json' || /\+json$/.test(type)) {
    return true;
  }

  return false;
}

function handleAnonymize(librarian, username, payload, callback) {
  if (!payload) {
    return callback(null, payload);
  }

  const viewer = username
    ? `user:${username}`
    : {
        '@type': 'Audience',
        audienceType: 'public'
      };

  const store = new Store();

  // payload has different shape based on the CouchDB call
  if (payload['@id'] || payload['@type']) {
    // payload is a doc
    librarian.anonymize(payload, { viewer, store }, callback);
  } else if (payload.results) {
    // payload is: { results: [ { id, docs: [{ok: {}}] },
    if (
      payload.results.some(res => res.docs && res.docs[0] && res.docs[0].ok)
    ) {
      asyncMapSeries(
        payload.results,
        (result, cb) => {
          if (result.docs && result.docs[0] && result.docs[0].ok) {
            librarian.anonymize(
              result.docs[0].ok,
              { viewer, store },
              (err, anonymizedDoc) => {
                if (err) return cb(err);
                cb(
                  null,
                  Object.assign({}, result, {
                    docs: [
                      Object.assign({}, result.docs[0], { ok: anonymizedDoc })
                    ]
                  })
                );
              }
            );
          } else {
            cb(null, result);
          }
        },
        (err, results) => {
          if (err) return callback(err);
          callback(err, Object.assign({}, payload, { results }));
        }
      );
    } else {
      callback(null, payload);
    }
  } else if (payload.rows) {
    // payload is { total_rows, rows:  [ { id, key, value, doc } ] },
    if (payload.rows.some(row => row.doc)) {
      asyncMapSeries(
        payload.rows,
        (row, cb) => {
          if (row.doc) {
            librarian.anonymize(
              row.doc,
              { viewer, store },
              (err, anonymizedDoc) => {
                if (err) return cb(err);
                cb(null, Object.assign({}, row, { doc: anonymizedDoc }));
              }
            );
          } else {
            cb(null, row);
          }
        },
        (err, rows) => {
          if (err) return callback(err);
          callback(err, Object.assign({}, payload, { rows }));
        }
      );
    } else {
      callback(null, payload);
    }
  } else {
    callback(null, payload);
  }
}

function cleanHeaders(headers = {}) {
  return omit(headers, [
    'transfer-encoding',
    'content-length',
    'content-encoding'
  ]);
}
