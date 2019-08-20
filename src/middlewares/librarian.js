import createError from '@scipe/create-error';
import {
  Librarian,
  parseUsername,
  createDb,
  createId,
  parseAuthorization
} from '@scipe/librarian';

export function addLibrarian(req, res, next) {
  if (!req.librarian) {
    req.librarian = new Librarian(req);
  }
  next();
}

export function validateBasicAuthCredentials(req, res, next) {
  const config = req.app.locals && req.app.locals.config;
  if (!config) {
    return createError(500, 'missing config');
  }
  const db = createDb(config);

  if (
    !req.headers['authorization'] ||
    !req.headers['authorization'].trim().startsWith('Basic')
  ) {
    return next();
  }

  const { username, password } = parseAuthorization(req);

  db.head(
    {
      url: `/${encodeURIComponent(createId('profile', username)._id)}`,
      auth: {
        username,
        password
      }
    },
    (err, resp, body) => {
      if (err) {
        return next(err);
      }
      if (resp && (resp.statusCode < 200 || resp.statusCode >= 300)) {
        return next(createError(401, 'invalid credentials'));
      }

      next();
    }
  );
}

export function acl({ checkCouchLogin = false } = {}) {
  return function(req, res, next) {
    if (!req.librarian) {
      req.librarian = new Librarian(req);
    }

    const config = req.app.locals && req.app.locals.config;
    if (config && !config.acl) {
      return next();
    }

    const username = parseUsername(req);
    req.log.trace({ checkCouchLogin, username }, 'acl middleware starts');
    if (username == null) {
      return next(createError(401));
    }
    const userId = `user:${username}`;
    req.username = username;
    req.userId = userId;

    handleCheckCouchLogin(req, { checkCouchLogin }, (err, ok, session) => {
      if (err) return next(err);
      if (!ok) {
        req.log.trace(
          { err, ok, session, username },
          'handleCheckCouchLogin in acl middleware was NOT OK'
        );
        return next(createError(401, 'need to re-login'));
      }
      next();
    });
  };
}

function handleCheckCouchLogin(req, { checkCouchLogin = false }, callback) {
  if (!req.session || !req.session.username) {
    callback(null, true);
  } else if (checkCouchLogin) {
    req.librarian.checkCouchLogin(callback);
  } else {
    callback(null, true);
  }
}

export function addUsername(req, res, next) {
  const username = parseUsername(req);
  if (username) {
    res.locals.username = username;
    req.username = username;
  }
  next();
}

export function addCsrfToken(req, res, next) {
  if (typeof req.csrfToken === 'function') {
    res.locals.csrfToken = req.csrfToken();
  } else {
    console.warn(
      'addCsrfToken token was called without access to req.csrfToken. You may need to add csurf middleware upstream'
    );
  }
  next();
}

export function addDbVersion(req, res, next) {
  res.locals.DB_VERSION = req.app.locals.DB_VERSION;
  next();
}

/**
 * See https://console.bluemix.net/docs/services/Cloudant/api/search.html#query-parameters for the cloudant params
 */
export function parseQuery(req, res, next) {
  try {
    req.query = Object.keys(req.query).reduce((query, key) => {
      const value = req.query[key];
      let parsed;

      switch (key) {
        // Boleans
        case 'upcoming':
        case 'anonymize':
        case 'cache':
        case 'update':
        case 'createCertificate':
        case 'includeDocs':
        case 'descending':
        case 'nodes':
        case 'includeActiveRoles':
        case 'addActiveRoleIds':
          parsed = String(value) === 'true';
          break;

        case 'frame':
          if (/true|false/.test(String(value))) {
            parsed = String(value) === 'true';
          } else {
            try {
              parsed = JSON.parse(req.query.frame);
            } catch (e) {
              throw createError(400, `invalid query string ${key} parameter`);
            }
          }
          break;

        case 'sort':
        case 'counts':
        case 'ranges':
        case 'drilldown':
        case 'types':
        case 'includeFields':
        case 'hydrate':
          if (value) {
            try {
              parsed = JSON.parse(value);
            } catch (e) {
              throw createError(400, `invalid query string ${key} parameter`);
            }
          }
          break;

        case 'type':
        case 'scope':
        case 'outscope': {
          // those take a string or an array of strings as value
          if (value) {
            try {
              // if `value` is a string, this will fail
              const _parsed = JSON.parse(value);
              if (
                Array.isArray(_parsed) &&
                _parsed.every(function(v) {
                  return typeof v === 'string';
                })
              ) {
                parsed = _parsed;
              }
            } catch (e) {
              if (typeof value === 'string') {
                parsed = [value];
              }
            }
            if (!parsed) {
              throw createError(400, `invalid query string ${key} parameter`);
            }
          }
          break;
        }

        case 'limit':
          parsed = parseInt(value, 10);
          break;

        case 'potentialActions':
          parsed =
            String(value) === 'true' || String(value) === 'false'
              ? String(value) === 'true'
              : value === 'all' ||
                value === 'bare' ||
                value === 'dashboard' ||
                value === 'reader'
              ? value
              : undefined;
          break;

        case 'compress':
          switch (value) {
            case true:
            case 'true':
              parsed = true;
              break;
            case false:
            case 'false':
              parsed = false;
              break;
            case 'auto':
              parsed = 'auto';
              break;
            default:
              throw createError(400, `invalid query string ${key} parameter`);
          }
          break;

        case 'version':
          parsed = value;
          break;

        case 'uploadAction':
          // TODO validate UUID ?
          parsed = value;
          break;

        case 'role':
          // TODO validate UUID ?
          parsed = value;
          break;

        case 'roleName':
          parsed = value;
          if (
            parsed !== 'editor' &&
            parsed !== 'reviewer' &&
            parsed !== 'author' &&
            parsed !== 'producer'
          ) {
            throw createError(400, `invalid query string ${key} parameter`);
          }
          break;

        default:
          parsed = value;
          break;
      }

      query[key] = parsed;

      return query;
    }, {});
  } catch (err) {
    return next(err);
  }

  next();
}
