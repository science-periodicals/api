import { Router } from 'express';
import createError from '@scipe/create-error';
import { contextLink, getId, arrayify } from '@scipe/jsonld';
import { Store } from '@scipe/librarian';
import { addLibrarian, parseQuery, acl } from '../middlewares/librarian';
import { cache } from '../utils/cache-utils';

const router = new Router({ caseSensitive: true });

/**
 * Get an encoding (support streaming and range)
 */
router.get(
  '/:encodingId',
  addLibrarian,
  parseQuery,
  (req, res, next) => {
    const qs = ['graph', 'version'].reduce((qs, key) => {
      const value = req.query[key];
      if (value) {
        qs += (qs ? '&' : '?') + `${key}=${req.query[key]}`;
      }
      return qs;
    }, '');

    const contentUrl = `/encoding/${req.params.encodingId}${qs}`;
    const store = new Store();

    // get encoding metadata and enforce ACL
    cache(
      req,
      callback => {
        req.librarian.getEncodingByContentUrl(
          contentUrl,
          { store },
          (err, encoding) => {
            if (err) {
              if (err.code === 404) {
                // The encoding may be present but only in an UploadAction or UpdateAction
                // that hasn't been committed to the Graph yet. We try to get if from there
                req.librarian.getPendingEncodingByContentUrl(
                  contentUrl,
                  { store },
                  (err, encoding) => {
                    if (err) return callback(err);
                    req.librarian.checkReadAcl(
                      encoding,
                      { acl: req.app.locals.config.acl, store },
                      callback
                    );
                  }
                );
              } else {
                callback(err);
              }
            } else {
              req.librarian.checkReadAcl(
                encoding,
                { acl: req.app.locals.config.acl, store },
                callback
              );
            }
          }
        );
      },
      { bare: true, prefix: 'acl' },
      (err, encoding) => {
        if (err) return next(err);
        req.encoding = encoding;
        next();
      }
    );
  },

  // serve encoding content
  (req, res, next) => {
    const { encoding } = req;

    if (req.headers['if-none-match']) {
      let matched = false;
      req.headers['if-none-match']
        .split(/\s*,\s*/)
        .map(inm => inm.replace(/^\s*W\//i, '').replace(/"/g, ''))
        .forEach(id => {
          if (matched) return;
          matched = id === encoding['@id'];
        });
      if (matched) return res.status(304).end();
    }

    const contentType = encoding.fileFormat;
    const contentEncoding = encoding.encoding
      ? arrayify(encoding.encoding)[0].encodingFormat || 'gzip' // when blob store gzip we have encoding.encoding defined. NOTE given that some encoding are flat, we hard code gzip to avoid to fetch the encoding.encoding document
      : undefined;
    const range = typeof req.headers.range === 'string' && req.headers.range;
    const bytesRx = /bytes=(.+)-(.+)?/;
    const isNumber = n => !isNaN(parseInt(n, 0)) && isFinite(n);
    let size = encoding.contentSize ? parseInt(encoding.contentSize, 10) : 0;
    let start = 0;
    let end = size ? size - 1 : 0;
    let isRange = false;
    if (size && range && bytesRx.test(range)) {
      const match = range.match(bytesRx);
      start =
        isNumber(match[1]) && match[1] > 0 && match[1] < end
          ? match[1] - 0
          : start;
      end =
        isNumber(match[2]) && match[2] > start && match[2] <= end
          ? match[2] - 0
          : end;
      isRange = true;
      size = end - start + 1;
    }

    // Cache-Control see:
    // - https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control
    // - https://jakearchibald.com/2016/caching-best-practices/
    // one-year cache
    res.set({
      'Cache-Control': `max-age=${365 * 24 * 60 * 60 * 1000}, ${
        req.session && req.session.username ? 'private' : 'public'
      }, immutable`,
      'Accept-Ranges': 'bytes',
      ETag: `"${encoding['@id']}"`
    });

    if (contentType) {
      res.set('Content-Type', contentType);
    }

    if (!isRange && size) {
      res.set('Content-Length', size);
    }

    if (
      contentEncoding &&
      contentEncoding !== 'identity' &&
      req.acceptsEncodings('gzip') //Note: for now only gzip (as that's all the blob store does), TODO check what the blob store did by getting encoding.encoding and possibly use `deflate`
    ) {
      res.set('Content-Encoding', contentEncoding);
    }

    const blobStoreGetOpts = {
      encodingId: getId(encoding),
      decompress: contentEncoding === 'gzip' && !req.acceptsEncodings('gzip'), // the browser will decompress for us Note: for now only gzip (as that's all the blob store does), TODO check what the blob store did by getting encoding.encoding and possibly use `deflate`
      range: isRange && [start, end]
    };

    // We respond with the content:
    // 2 cases:
    // - no range and small HTML encoding => we use an extra redis cache
    // - range or large or non HTML encoding => we stream
    if (
      req.query.cache != false &&
      !isRange &&
      encoding.fileFormat === 'text/html' &&
      encoding.contentSize <= 2e6
    ) {
      cache(
        req,
        callback => {
          req.librarian.blobStore.get(
            encoding,
            blobStoreGetOpts,
            (err, buffer) => {
              if (err) return callback(err);
              // Note: our node redis client is configured to work with strings
              // as the `detect_buffers` option is not reliable
              // See https://stackoverflow.com/questions/20732332/how-to-store-a-binary-object-in-redis-using-node
              callback(
                null,
                contentEncoding === 'gzip' && req.acceptsEncodings('gzip')
                  ? buffer.toString('base64') // we will convert back to a buffer
                  : buffer.toString()
              );
            }
          );
        },
        { bare: true },
        (err, payload) => {
          if (err) return next(err);

          res.send(
            contentEncoding === 'gzip' && req.acceptsEncodings('gzip')
              ? Buffer.from(payload, 'base64')
              : payload
          );
        }
      );
    } else {
      const readStream = req.librarian.blobStore.get(
        encoding,
        blobStoreGetOpts
      );

      if (isRange) {
        res.status(206);
        res.set(
          'Content-Range',
          `bytes ${start}-${end}/${encoding.contentSize}`
        );
        res.set('Content-Length', size);
      }

      readStream.on('error', err => {
        req.log.warn(err, 'error fetching blob from blob store');
        next(createError(404, `Error in blobStore readStream: ${err.message}`));
        readStream.unpipe();
      });

      readStream.pipe(res);
    }
  }
);

/**
 * Upload an encoding
 */
router.post('/', addLibrarian, parseQuery, acl(), (req, res, next) => {
  const {
    compress, // boolean, `auto` or undefined
    update, // boolean indicating if the result of a webify action (if any) should be auto applied by the worker
    name, // file name
    context, // @id of an action granting write access to Graph (CreateReleaseAction or TypesettingAction) when upload is releted to Graph or @id of a Periodical, Person or Organization etc. (static assets)
    version, // for when context is a release
    resource, // optional resourceId for when context is a CreateReleaseAction, required styleId or property (`logo`, `image`, `audio`, `video`) otherwise
    uploadAction, // optional UUID to specify the UploadAction @id
    role // unprefixed roleId (librarian will validate that the roleId is compatible with req.session.userId)
  } = req.query;

  // validate qs
  if (!name) {
    return next(createError(400, `missing "name" query string parameter`));
  }

  if (!context) {
    return next(createError(400, `missing "context" query string parameter`));
  }

  if (!resource && !context.startsWith('action:')) {
    return next(createError(400, `missing "resource" query string parameter`));
  }

  const readableStream = req;
  req.librarian.upload(
    readableStream,
    {
      acl: req.app.locals.config.acl,
      update,
      fileFormat: req.get('Content-Type') || 'application/octet-stream',
      context,
      version,
      resource,
      name,
      creator: role ? `role:${role}` : req.userId,
      uploadActionId: uploadAction,
      anonymize: req.app.locals.config.anonymize,
      compress
    },
    (err, uploadAction) => {
      if (err) return next(err);

      res.set('Link', contextLink);
      res
        .status(
          uploadAction.actionStatus !== 'CompletedActionStatus' ? 202 : 200
        )
        .json(uploadAction);
    }
  );
});

export default router;
