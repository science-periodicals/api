import assert from 'assert';
import request from 'request';
import uuid from 'uuid';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';
import registerUser from './utils/register-user';

describe('Action', function() {
  this.timeout(40000);

  let server, user, auth;

  before(function(done) {
    server = createServer({
      openRegistration: true,
      skipPayments: true,
      rateLimiterPoints: 100
    });
    server.listen(portHttp, () => {
      registerUser((err, _user, _auth) => {
        if (err) return done(err);
        user = _user;
        auth = _auth;
        done();
      });
    });
  });

  it('should 401 when trying to access the route without auth', done => {
    client.delete(
      {
        url: `/action/actionId`
      },
      (err, resp, body) => {
        if (err) return done(err);
        assert.equal(resp.statusCode, 401);
        done();
      }
    );
  });

  it('should 401 when using a wrong password', done => {
    client.get(
      {
        url: '/action',
        auth: Object.assign({}, auth, { password: uuid.v4() }),
        json: true,
        qs: {
          limit: 1
        }
      },
      (err, resp, body) => {
        if (err) return done(err);
        assert.equal(resp.statusCode, 401);
        done();
      }
    );
  });

  it('should 401 when using a wrong username', done => {
    client.get(
      {
        url: '/action',
        auth: Object.assign({}, auth, { username: uuid.v4() }),
        json: true,
        qs: {
          limit: 1
        }
      },
      (err, resp, body) => {
        if (err) return done(err);
        assert.equal(resp.statusCode, 401);
        done();
      }
    );
  });

  it('should list all the actions and provide working next link', done => {
    client.get(
      {
        url: '/action',
        auth: auth,
        json: true,
        qs: {
          limit: 1
        }
      },
      (err, resp, body) => {
        if (err) return done(err);

        const nextUrl =
          body.itemListElement[body.itemListElement.length - 1].nextItem;

        request.get(
          {
            url: nextUrl,
            auth: auth,
            json: true
          },
          (err, resp, body) => {
            if (err) return done(err);

            assert.equal(resp.statusCode, 200);
            done();
          }
        );
      }
    );
  });

  it('should error with a body without appropriate content-type', done => {
    client.post(
      {
        url: '/action',
        body: JSON.stringify({
          '@type': 'RegisterAction',
          actionStatus: 'CompletedActionStatus',
          agent: {
            '@id': `user:${uuid.v4()}`,
            email: `success+${uuid.v4()}@simulator.amazonses.com`,
            password: uuid.v4()
          }
        })
      },
      (err, resp, body) => {
        if (err) return done(err);
        assert.equal(resp.statusCode, 415);
        done();
      }
    );
  });

  it('should work when POSTing JSON-LD data (testing that body parser parses json-ld)', done => {
    client.post(
      {
        url: '/action',
        headers: {
          'Content-Type': 'application/ld+json'
        },
        body: JSON.stringify({
          '@type': 'RegisterAction',
          actionStatus: 'ActiveActionStatus',
          agent: {
            '@id': `user:${uuid.v4()}`,
            email: `success+${uuid.v4()}@simulator.amazonses.com`
          },
          instrument: {
            '@type': 'Password',
            value: 'pass'
          }
        })
      },
      (err, resp, body) => {
        if (err) return done(err);
        body = JSON.parse(body);
        assert.equal(body.actionStatus, 'ActiveActionStatus');
        done();
      }
    );
  });

  after(() => {
    server.destroy();
  });
});
