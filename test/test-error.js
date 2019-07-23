import http from 'http';
import express from 'express';
import { error } from '../src';
import assert from 'assert';
import request from 'request';
import createError from '@scipe/create-error';

const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT_HTTP || 3000;
const client = request.defaults({
  baseUrl: 'http://' + host + ':' + port
});

describe('error middleware', function() {
  var server;

  before(done => {
    const app = express();
    app.get('/', (req, res, next) => {
      next(createError(500, 'internal server error'));
    });
    app.get('/action', (req, res, next) => {
      const err = createError(500, 'internal server error');
      err.action = {
        '@type': 'Action'
      };
      next(err);
    });
    app.get('/code', (req, res, next) => {
      const err = new Error('boom');
      err.code = 'ENOENT';
      next(err);
    });

    app.use(error());

    server = http.createServer(app);
    server.listen(port, done);
  });

  it('should get a JSON error when called accepting JSON', done => {
    client.get(
      {
        url: '/',
        headers: {
          Accept: 'application/json'
        }
      },
      (err, resp, body) => {
        assert.equal(resp.statusCode, 500);
        assert(JSON.parse(body).description);
        done();
      }
    );
  });

  it('should get a FailedAction', done => {
    client.get(
      {
        url: '/action',
        headers: {
          Accept: 'application/json'
        }
      },
      (err, resp, body) => {
        assert.equal(resp.statusCode, 500);
        assert(JSON.parse(body).error.description);
        done();
      }
    );
  });

  it('should not crash with invalid error code', done => {
    client.get(
      {
        url: '/action',
        headers: {
          Accept: 'application/json'
        }
      },
      (err, resp, body) => {
        // the invalid code is turned into 500
        assert.equal(resp.statusCode, 500);
        done();
      }
    );
  });

  after(done => {
    server.close(done);
  });
});
