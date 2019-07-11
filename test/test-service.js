import assert from 'assert';
import request from 'request';
import createError from '@scipe/create-error';
import registerUser from './utils/register-user';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';

describe('Service', function() {
  this.timeout(40000);

  let server, user, auth;

  before(function(done) {
    server = createServer({ skipPayments: true, rateLimiterPoints: 100 });
    server.listen(portHttp, () => {
      // register user

      registerUser((err, _user, _auth) => {
        if (err) return done(err);
        user = _user;
        auth = _auth;
        done();
      });
    });
  });

  it('should get a service', done => {
    client.get(
      {
        url: '/service/scipe',
        auth,
        json: true
      },
      (err, resp, body) => {
        assert.equal(resp.statusCode, 200);
        assert.equal(body['@id'], 'service:scipe');
        done();
      }
    );
  });

  it('should list the services and provide working next link', done => {
    client.get(
      {
        url: '/service',
        auth: auth,
        json: true,
        qs: {
          limit: 1
        }
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }
        // console.log(require('util').inspect(body, { depth: null }));
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

  after(() => {
    server.destroy();
  });
});
