import assert from 'assert';
import uuid from 'uuid';
import createError from '@scipe/create-error';
import {
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions
} from '@scipe/librarian';
import { unprefix, getId } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';

describe('Workflow', function() {
  this.timeout(40000);

  let server, user, auth, organization, periodical, workflowSpecification;

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
                      '@type': 'CreateWorkflowSpecificationAction',
                      agent: getId(user),
                      object: getId(periodical),
                      result: {
                        '@type': 'WorkflowSpecification',
                        expectedDuration: 'P60D',
                        potentialAction: {
                          '@type': 'CreateGraphAction',
                          result: {
                            '@type': 'Graph',
                            hasDigitalDocumentPermission: [
                              'editor',
                              'reviewer',
                              'author',
                              'producer'
                            ].map(audienceType => {
                              return {
                                '@type': 'DigitalDocumentPermission',
                                permissionType: 'AdminPermission',
                                grantee: {
                                  '@type': 'Audience',
                                  audienceType
                                }
                              };
                            })
                          }
                        }
                      }
                    }
                  },
                  (err, resp, body) => {
                    if ((err = createError(err, resp, body))) {
                      return done(err);
                    }

                    workflowSpecification = body.result;

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

  it('should get a workflow', done => {
    client.get(
      {
        url: `/workflow/${unprefix(getId(workflowSpecification))}`,
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }
        assert.equal(resp.statusCode, 200);
        assert.equal(body['@type'], 'WorkflowSpecification');
        done();
      }
    );
  });

  after(() => {
    server.destroy();
  });
});
