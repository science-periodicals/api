import assert from 'assert';
import uuid from 'uuid';
import createError from '@scipe/create-error';
import { createId } from '@scipe/librarian';
import { unprefix, getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';

describe('Periodical', function() {
  this.timeout(40000);

  let server, user, auth, organization, periodical;

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

            client.post(
              {
                url: '/action',
                auth,
                json: {
                  '@type': 'CreatePeriodicalAction',
                  agent: getId(user),
                  actionStatus: 'CompletedActionStatus',
                  object: getId(organization),
                  result: {
                    '@id': createId('journal', uuid.v4())['@id'],
                    '@type': 'Periodical',
                    name: 'my journal',
                    hasDigitalDocumentPermission: {
                      '@type': 'DigitalDocumentPermission',
                      permissionType: 'ReadPermission',
                      grantee: {
                        '@type': 'Audience',
                        audienceType: 'public'
                      }
                    },
                    editor: {
                      '@type': 'ContributorRole',
                      roleName: 'editor',
                      editor: getId(user)
                    }
                  }
                }
              },
              (err, resp, body) => {
                if ((err = createError(err, resp, body))) return done(err);

                periodical = body.result;
                done();
              }
            );
          }
        );
      });
    });
  });

  it('should get a periodical by id', done => {
    client.get(
      {
        url: `/periodical/${unprefix(getId(periodical))}`,
        auth: auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return done(err);
        assert.equal(resp.statusCode, 200);
        assert.equal(body['@type'], 'Periodical');
        done();
      }
    );
  });

  it('should list all the periodicals', done => {
    client.get(
      {
        url: '/periodical',
        auth: auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return done(err);
        assert.equal(body['@type'], 'SearchResultList');
        done();
      }
    );
  });

  after(() => {
    server.destroy();
  });
});
