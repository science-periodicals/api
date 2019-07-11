import assert from 'assert';
import uuid from 'uuid';
import createError from '@scipe/create-error';
import {
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions,
  getAgent
} from '@scipe/librarian';
import { unprefix, getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';

describe('Role', function() {
  this.timeout(40000);

  let server, user, auth, organization, periodical, graph;

  before(function(done) {
    server = createServer({ skipPayments: true, rateLimiterPoints: 100 });
    server.listen(portHttp, () => {
      registerUser(
        {
          '@type': 'Person',
          knowsAbout: [
            {
              '@id': 'subjects:chemical-engineering',
              name: 'Chemical engineering'
            },
            {
              '@id': 'subjects:research-data',
              name: 'Research data'
            }
          ]
        },
        (err, _user, _auth) => {
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
                      hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
                        user,
                        {
                          createGraphPermission: true,
                          publicReadPermission: true
                        }
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

                      const workflowSpecification = body.result;

                      const defaultCreateGraphAction = arrayify(
                        workflowSpecification.potentialAction
                      ).find(action => action['@type'] === 'CreateGraphAction');

                      client.post(
                        {
                          url: '/action',
                          auth,
                          json: Object.assign({}, defaultCreateGraphAction, {
                            actionStatus: 'CompletedActionStatus',
                            agent: { roleName: 'author', agent: getId(user) },
                            participant: getId(arrayify(periodical.editor)[0]),
                            result: {
                              '@id': createId('graph', uuid.v4())['@id'],
                              '@type': 'Graph',
                              mainEntity: '_:article',
                              author: {
                                roleName: 'author',
                                author: getId(user)
                              },
                              editor: getId(arrayify(periodical.editor)[0]),
                              '@graph': [
                                {
                                  '@id': '_:article',
                                  '@type': 'ScholarlyArticle',
                                  name: 'my article'
                                }
                              ]
                            }
                          })
                        },
                        (err, resp, body) => {
                          if ((err = createError(err, resp, body))) {
                            return done(err);
                          }
                          graph = body.result;
                          done();
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });

  it('should get a periodical role by role id', done => {
    const role = arrayify(periodical.editor)[0];

    client.get(
      {
        url: `/role/${unprefix(getId(role))}`,
        auth: auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return done(err);
        assert.equal(resp.statusCode, 200);
        assert.equal(body['@type'], 'ContributorRole');
        //console.log(require('util').inspect(body, { depth: null }));

        done();
      }
    );
  });

  it('should get a list of anonymized roles', done => {
    client.get(
      {
        url: `/role`,
        qs: {
          anonymize: true,
          graph: unprefix(getId(graph)),
          roleName: 'editor'
        },
        auth: auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return done(err);
        assert.equal(resp.statusCode, 200);
        assert.equal(body['@type'], 'SearchResultList');
        const anonymized = body.itemListElement[0].item;
        assert(getId(anonymized).startsWith('anon:'));
        // check that @type and subjects were embedded
        assert.equal(anonymized.editor['@type'], 'Person');
        assert(anonymized.editor.knowsAbout);

        // console.log(require('util').inspect(body, { depth: null }));

        done();
      }
    );
  });

  it('should get a list of roles for the user', done => {
    client.get(
      {
        url: `/role`,
        qs: {
          user: auth.username
        },
        auth: auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) return done(err);
        assert.equal(resp.statusCode, 200);
        assert.equal(body['@type'], 'SearchResultList');
        // console.log(require('util').inspect(body, { depth: null }));
        assert(
          body.itemListElement.every(
            listItem => listItem.item['@type'] === 'ContributorRole'
          )
        );
        // check that anonymize is called
        assert(
          body.itemListElement.some(listItem => {
            const role = listItem.item;
            const user = getAgent(role);
            return (
              user && arrayify(user.sameAs).some(id => id.startsWith('anon:'))
            );
          })
        );

        done();
      }
    );
  });

  after(() => {
    server.destroy();
  });
});
