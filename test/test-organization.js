import assert from 'assert';
import uuid from 'uuid';
import createError from '@scipe/create-error';
import { getId, unprefix } from '@scipe/jsonld';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';
import registerUser from './utils/register-user';

describe('Organization', function() {
  this.timeout(40000);

  let server, user, organization, auth;

  before(function(done) {
    server = createServer({ skipPayments: true, rateLimiterPoints: 100 });
    server.listen(portHttp, () => {
      registerUser((err, _user, _auth) => {
        if (err) return done(err);
        user = _user;
        auth = _auth;

        client.post(
          {
            url: '/action',
            json: {
              '@type': 'CreateOrganizationAction',
              agent: user,
              actionStatus: 'CompletedActionStatus',
              result: {
                '@id': `org:${uuid.v4()}`,
                '@type': 'Organization',
                name: `name`
              }
            },
            auth
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) return done(err);

            organization = body.result;
            done();
          }
        );
      });
    });
  });

  it('should get an organization', done => {
    client.get(
      {
        url: `/organization/${unprefix(getId(organization))}`,
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return done(err);
        assert.equal(resp.statusCode, 200);
        assert.equal(body['@type'], 'Organization');
        done();
      }
    );
  });

  after(() => {
    server.destroy();
  });
});
