import assert from 'assert';
import uuid from 'uuid';
import createError from '@scipe/create-error';
import { unprefix, arrayify, getId } from '@scipe/jsonld';
import {
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions
} from '@scipe/librarian';
import registerUser from './utils/register-user';
import createServer from './utils/create-server';
import { client, portHttp, admin, dbName } from './utils/config';

describe('PouchDB loader (fast forward replication)', function() {
  this.timeout(40000);

  let server, user, auth, organization, periodical, graph, deletedAction;

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

                    const workflowSpecification = body.result;

                    client.post(
                      {
                        url: '/action',
                        auth,
                        json: {
                          '@type': 'CreatePublicationTypeAction',
                          actionStatus: 'CompletedActionStatus',
                          agent: getId(user),
                          object: getId(periodical),
                          result: {
                            name: 'Research article',
                            eligibleWorkflow: getId(workflowSpecification),
                            objectSpecification: {
                              '@type': 'Graph',
                              mainEntity: {
                                '@type': 'ScholarlyArticle',
                                'description-input': {
                                  '@type': 'PropertyValueSpecification',
                                  valueRequired: true,
                                  valueMaxlength: 100
                                }
                              }
                            }
                          }
                        }
                      },
                      (err, resp, body) => {
                        if ((err = createError(err, resp, body))) {
                          return done(err);
                        }

                        const type = body.result;

                        const defaultCreateGraphAction = arrayify(
                          workflowSpecification.potentialAction
                        ).find(
                          action => action['@type'] === 'CreateGraphAction'
                        );

                        client.post(
                          {
                            url: '/action',
                            auth,
                            json: Object.assign({}, defaultCreateGraphAction, {
                              actionStatus: 'CompletedActionStatus',
                              agent: getId(user),
                              result: {
                                '@id': createId('graph', uuid.v4())['@id'],
                                '@type': 'Graph',
                                additionalType: getId(type),
                                mainEntity: '_:article',
                                author: {
                                  roleName: 'author',
                                  author: getId(user)
                                },
                                '@graph': [
                                  {
                                    '@id': '_:article',
                                    '@type': 'ScholarlyArticle',
                                    name: 'my article'
                                  },
                                  {
                                    '@id': '_:dataset',
                                    '@type': 'Dataset',
                                    name: 'my dataset'
                                  }
                                ]
                              }
                            })
                          },
                          (err, resp, action) => {
                            if ((err = createError(err, resp, action))) {
                              return done(err);
                            }
                            graph = action.result;

                            // delete the createGraphAction so we can test that the deleted docs are loaded

                            admin.put(
                              {
                                url: `/${dbName}/${action._id}`,
                                json: Object.assign({}, action, {
                                  _deleted: true
                                })
                              },
                              (err, resp, body) => {
                                if ((err = createError(err, resp, body))) {
                                  return done(err);
                                }

                                deletedAction = action;
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
          }
        );
      });
    });
  });

  it('should load a periodical', done => {
    client.post(
      {
        url: `/load/periodical/${unprefix(getId(periodical))}`,
        auth: auth,
        json: []
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }
        assert(body.every(doc => doc._revisions));
        done();
      }
    );
  });

  it('should load a graph, associated actions, workflow and publication type', done => {
    client.post(
      {
        url: `/load/graph/${unprefix(getId(graph['@id']))}`,
        auth: auth,
        json: []
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        // console.log(require('util').inspect(body, { depth: null }));

        assert(body.every(doc => doc._revisions));

        // check that workflow was loaded
        const workflow = body.find(
          doc =>
            doc['@type'] === 'WorkflowSpecification' &&
            (doc['@id'] || '').startsWith('workflow:')
        );
        assert(workflow, 'workflow was loaded');

        // check that type was loaded
        const type = body.find(
          doc =>
            doc['@type'] === 'PublicationType' &&
            (doc['@id'] || '').startsWith('type:')
        );
        assert(type, 'publication type was loaded');

        done();
      }
    );
  });

  it('should handle deleted nodes', done => {
    client.post(
      {
        url: `/load/graph/${unprefix(getId(graph['@id']))}`,
        auth: auth,
        json: [{ id: deletedAction._id, rev: deletedAction._rev }],
        qs: { type: 'action' }
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        // console.log(require('util').inspect(body, { depth: null }));
        const deleted = body.find(
          doc => doc['@type'] === deletedAction['@type']
        );

        assert(deleted && deleted._deleted);
        done();
      }
    );
  });

  after(() => {
    server.destroy();
  });
});
