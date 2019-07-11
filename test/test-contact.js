import assert from 'assert';
import uuid from 'uuid';
import createError from '@scipe/create-error';
import { unprefix, getId, arrayify } from '@scipe/jsonld';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';
import registerUser from './utils/register-user';

describe('Contact points', function() {
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

  it('should get a user contact point', done => {
    const contactPoint = arrayify(user.contactPoint)[0];
    client.get(
      {
        url: `/contact/${unprefix(getId(contactPoint))}`,
        auth: auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return done(err);
        // console.log(body);
        assert.equal(resp.statusCode, 200);
        assert.equal(body['@type'], 'ContactPoint');
        done();
      }
    );
  });

  it('should update a contact point email and be able to verify it with the approve endpoint', done => {
    const contactPoint = arrayify(user.contactPoint)[0];
    const updatedEmail = `mailto:success+${uuid.v4()}@simulator.amazonses.com`;

    client.post(
      {
        url: '/action',
        auth,
        json: {
          '@type': 'UpdateContactPointAction',
          agent: getId(user),
          actionStatus: 'CompletedActionStatus',
          object: {
            email: updatedEmail
          },
          targetCollection: getId(contactPoint),
          potentialAction: {
            '@type': 'InformAction',
            actionStatus: 'CompletedActionStatus',
            instrument: {
              '@type': 'EmailMessage',
              text: {
                '@type': 'sa:ejs',
                '@value': '<%= emailVerificationToken.value %>'
              }
            }
          }
        }
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return done(err);
        assert.equal(resp.statusCode, 200);

        const tokenValue = arrayify(body.potentialAction)[0].instrument.text;
        client.get(
          {
            url: `/contact/${unprefix(getId(contactPoint))}/validate`,
            followRedirect: false,
            qs: {
              action: unprefix(getId(body)),
              token: tokenValue,
              next: 'https://sci.pe/settings'
            }
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) return done(err);
            assert.equal(resp.statusCode, 303);
            assert.equal(resp.headers.location, 'https://sci.pe/settings');
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
