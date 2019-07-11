import assert from 'assert';
import createError from '@scipe/create-error';
import uuid from 'uuid';
import {
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions
} from '@scipe/librarian';
import { unprefix, getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import { client, portHttp } from './utils/config';
import createServer from './utils/create-server';

describe('Issue', function() {
  this.timeout(80000);

  let server, user, auth, organization, periodical, issue;

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
            auth,
            json: {
              '@type': 'CreateOrganizationAction',
              agent: user,
              actionStatus: 'CompletedActionStatus',
              result: {
                '@id': `org:${uuid.v4()}`,
                '@type': 'Organization',
                name: `name`
              }
            }
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
                    hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
                      user,
                      { createGraphPermission: true }
                    ),
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

                client.post(
                  {
                    url: '/action',
                    auth,
                    json: {
                      '@type': 'CreatePublicationIssueAction',
                      actionStatus: 'CompletedActionStatus',
                      agent: getId(user),
                      object: getId(periodical),
                      result: {
                        '@type': 'PublicationIssue'
                      }
                    }
                  },
                  (err, resp, body) => {
                    if ((err = createError(err, resp, body))) {
                      return done(err);
                    }

                    issue = body.result;

                    done();
                  }
                );
              }
            );
          }
        );
      });
    });
  });

  it('should get an issue', done => {
    client.get(
      {
        url: `/issue/${unprefix(getId(periodical))}/${
          unprefix(getId(issue)).split('/', 2)[1]
        }`,
        json: true,
        auth: auth
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        assert.equal(body['@type'], 'PublicationIssue');
        done();
      }
    );
  });

  it('should search for issues', done => {
    client.get(
      {
        url: '/issue',
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
        assert(body.numberOfItems);
        done();
      }
    );
  });

  after(() => {
    server.destroy();
  });
});
