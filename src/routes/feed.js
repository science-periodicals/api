import { Router } from 'express';
import pick from 'lodash/pick';
import omit from 'lodash/omit';
import once from 'once';
import { parseIndexableString } from '@scipe/collate';
import { contextUrl, contextLink, arrayify } from '@scipe/jsonld';
import {
  getScopeId,
  parseAuthorization,
  mapChangeToSchema,
  createId,
  parseUsername
} from '@scipe/librarian';
import createError from '@scipe/create-error';
import Feed from '@scipe/feed';
import { addLibrarian, parseQuery } from '../middlewares/librarian';

const router = new Router({ caseSensitive: true });

/**
 * Serve the changes feed using SSE
 * see https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
 */
router.get(
  '/',
  addLibrarian,
  parseQuery,
  (req, res, next) => {
    // validate qs and perform acl
    if ('nodes' in req.query && String(req.query.nodes) !== 'false') {
      return next(
        createError(400, 'invalid value for query string parameter nodes')
      );
    }

    if (req.query.limit) {
      if (req.query.limit > 200) {
        return next(createError(403, 'limit must be smaller or equal to 200'));
      }
    } else {
      req.query.limit = 200;
    }

    const scopes = arrayify(req.query.scope);

    if (!req.query.filter) {
      req.query.filter = 'public';
    }
    if (!/^user$|^admin$|^public$/.test(req.query.filter)) {
      return next(
        createError(
          400,
          'Invalid query string filter parameter. Possible values are user, admin or public'
        )
      );
    }

    // ACL
    switch (req.query.filter) {
      case 'admin': {
        // in any case need to be logged in
        req.librarian.checkAcl(
          { acl: req.app.locals.config.acl },
          (err, check) => {
            if (err) return next(err);
            if (check.isAdmin) {
              next();
            } else {
              next(
                createError(
                  403,
                  'Unauthorized: you need to be admin to use the admin filter'
                )
              );
            }
          }
        );
        break;
      }

      case 'user': {
        // be sure that the user has access to the scope (can be a journalId or graphId)
        // in any case need to be logged in
        req.librarian.checkAcl(
          { acl: req.app.locals.config.acl, docs: scopes },
          (err, check) => {
            if (err) return next(err);
            const unauthorizedScopes = arrayify(scopes).filter(scope => {
              const scopeId = getScopeId(scope);
              return (
                !scopeId.startsWith('user:') &&
                !(
                  check([scopeId, 'ReadPermission']) ||
                  check([scopeId, 'WritePermission']) ||
                  check([scopeId, 'AdminPermission'])
                )
              );
            });
            if (unauthorizedScopes.length) {
              next(
                createError(
                  403,
                  `Unauthorized: scope parameter is used for scopes the user do not have access to: ${unauthorizedScopes.join(
                    ', '
                  )}`
                )
              );
            } else {
              next();
            }
          }
        );
        break;
      }

      default:
        next();
    }
  },
  (req, res, next) => {
    // handle SSE response (see next middleware for JSON / JSON-LD response)
    if (
      req.accepts('application/json') ||
      req.accepts('application/ld+json') ||
      !(
        req.accepts('text/event-stream') ||
        req.query.accept == 'text/event-stream'
      )
    ) {
      return next();
    }

    const filterQueryParams = pick(req.query, ['scope', 'outscope', 'nodes']);
    let creds;
    if (req.query.filter === 'user') {
      let { username, password } = parseAuthorization(req);
      creds = {
        couchUsername: username,
        couchPassword: password
      };
      filterQueryParams.user = createId(
        'user',
        username || req.session.username
      )['@id']; // workaround for Cloudant post CouchDB 2.0 update where req.userCtx is sometimes undefined
    }
    const since = (
      req.headers['last-event-id'] ||
      req.query['last-event-id'] ||
      'now'
    ).replace(/^seq:/, '');
    let intervalId, feed;
    const cleanUp = once(err => {
      if (err) {
        req.log.error({ err }, 'closing feed due to error');
      } else {
        req.log.debug('closing feed');
      }
      if (feed) {
        feed.close();
      }
      clearInterval(intervalId);
    });

    feed = new Feed(
      Object.assign(
        {},
        req.app.locals.config,
        {
          librarian: req.librarian,
          filter: `scienceai/${req.query.filter}`,
          safe: false, // we do _not_ want to use Redis here. Redis should only be used when we do changes feed processing
          filterQueryParams
        },
        creds
      )
    )
      .on('error', err => {
        req.log.error({ err }, 'error from the changes feed');
        cleanUp(err);
      })
      .on('listening', since => {
        req.log.debug({ since: since }, 'starting to listen to changes feed');
      })
      .register((dataFeedItem, callback) => {
        req.log.trace({ dataFeedItem }, 'feed event');
        if (dataFeedItem['@id'] && dataFeedItem.item && dataFeedItem.item._id) {
          const [scopeId, type] = parseIndexableString(dataFeedItem.item._id);
          let event;
          switch (type) {
            case 'profile':
              event = 'UserProfile';
              break;

            case 'org':
              event = 'Organization';
              break;

            case 'role':
              event = 'Role';
              break;

            case 'graph':
            case 'release':
            case 'node':
              event = 'Graph';
              break;

            case 'action':
              event = 'Action';
              break;

            case 'journal':
              event = 'Periodical';
              break;

            case 'service':
              event = 'Service';
              break;
            default:
              event = null;
          }

          handleAnonymize(
            dataFeedItem,
            {
              librarian: req.librarian,
              username: parseUsername(req),
              anonymize: req.app.locals.config.anonymize
            },
            (err, dataFeedItem) => {
              if (err) {
                return callback(err);
              }

              let { item } = dataFeedItem;
              if (item) {
                const id = dataFeedItem['@id'];
                const data = JSON.stringify(
                  item['@type'] === 'Graph' &&
                    String(req.query.nodes) === 'false'
                    ? omit(item, ['@graph'])
                    : item
                );
                const sse = event
                  ? `id: ${id}\nevent: ${event}\ndata: ${data}\n\n`
                  : `id: ${id}\ndata: ${data}\n\n`;
                res.write(sse, 'utf8');
                callback(null);
              }
            }
          );
        } else {
          callback(null);
        }
      })
      .listen(since, err => {
        if (err) return next(err);
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });
        // keep connection alive
        intervalId = setInterval(() => {
          res.write(`: ${new Date().toISOString()}\n\n`);
        }, 1000);
      });

    req.on('aborted', cleanUp);
    req.on('close', cleanUp);

    // TODO ? integrate with action worker (zmq to have real time progress event of the workers). Need XPUB XSUB broker
  },
  (req, res, next) => {
    // handle JSON / JSON-LD response (user did not want SSE)
    req.librarian.db.get(
      {
        url: '/_changes',
        qs: Object.assign(
          pick(req.query, [
            'limit',
            'descending',
            'scope',
            'outscope',
            'nodes'
          ]),
          {
            filter: `scienceai/${req.query.filter}`,
            since: (
              req.headers['last-event-id'] ||
              req.query['last-event-id'] ||
              'now'
            ).replace(/^seq:/, ''),
            include_docs: true
          }
        ),
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return next(err);
        }

        const changes = body.results;
        let dataFeedElement;
        if (changes.length === 0) {
          dataFeedElement = [
            { '@id': `seq:${body.last_seq}`, '@type': 'DataFeedItem' }
          ];
        } else {
          dataFeedElement = [];
          changes.forEach(change => {
            if (change.doc) {
              const dataFeedItem = mapChangeToSchema(change);
              if (
                dataFeedItem.item['@type'] === 'Graph' &&
                String(req.query.nodes) === 'false'
              ) {
                delete dataFeedItem.item['@graph'];
              }
              dataFeedElement.push(dataFeedItem);
            }
          });
        }

        handleAnonymize(
          dataFeedElement,
          {
            librarian: req.librarian,
            username: parseUsername(req),
            anonymize: req.app.locals.config.anonymize
          },
          (err, dataFeedElement) => {
            if (err) return next(err);

            res.set('Link', contextLink);
            res.json({
              '@context': contextUrl,
              '@type': 'DataFeed',
              dataFeedElement: dataFeedElement
            });
          }
        );
      }
    );
  }
);

function handleAnonymize(
  payload, // a DataFeedItem or list thereof
  { librarian, username, anonymize },
  callback
) {
  const viewer = username
    ? `user:${username}`
    : { '@type': 'Audience', audienceType: 'public' };

  librarian.anonymize(payload, { viewer, anonymize }, callback);
}

export default router;
