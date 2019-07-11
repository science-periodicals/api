import assert from 'assert';
import PouchDB from 'pouchdb';
import uuid from 'uuid';
import createError from '@scipe/create-error';
import {
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions
} from '@scipe/librarian';
import { getId, arrayify } from '@scipe/jsonld';
import registerUser from './utils/register-user';
import createServer from './utils/create-server';
import { client, portHttp, couchRemoteUrl } from './utils/config';
import memoryAdapter from 'pouchdb-adapter-memory';
PouchDB.plugin(memoryAdapter);

describe('CouchDB Proxy', function() {
  this.timeout(40000);

  let server, user, auth, author, authorAuth, organization, periodical, graph;

  before(function(done) {
    server = createServer({ skipPayments: true, rateLimiterPoints: 100 });
    server.listen(portHttp, () => {
      registerUser((err, _user, _auth) => {
        if (err) return done(err);
        user = _user;
        auth = _auth;

        registerUser((err, _author, _authorAuth) => {
          if (err) return done(err);
          author = _author;
          authorAuth = _authorAuth;

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
                                {
                                  '@type': 'DigitalDocumentPermission',
                                  permissionType: 'AdminPermission',
                                  grantee: {
                                    '@type': 'Audience',
                                    audienceType: 'editor'
                                  }
                                },
                                {
                                  '@type': 'DigitalDocumentPermission',
                                  permissionType: 'AdminPermission',
                                  grantee: {
                                    '@type': 'Audience',
                                    audienceType: 'producer'
                                  }
                                },

                                {
                                  '@type': 'DigitalDocumentPermission',
                                  permissionType: 'WritePermission',
                                  grantee: {
                                    '@type': 'Audience',
                                    audienceType: 'author'
                                  }
                                },
                                {
                                  '@type': 'DigitalDocumentPermission',
                                  permissionType: 'WritePermission',
                                  grantee: {
                                    '@type': 'Audience',
                                    audienceType: 'reviewer'
                                  }
                                },

                                // editor cannot view identity of author
                                {
                                  '@type': 'DigitalDocumentPermission',
                                  permissionType: 'ViewIdentityPermission',
                                  grantee: {
                                    '@type': 'Audience',
                                    audienceType: 'author'
                                  },
                                  permissionScope: [
                                    {
                                      '@type': 'Audience',
                                      audienceType: 'author'
                                    },
                                    {
                                      '@type': 'Audience',
                                      audienceType: 'editor'
                                    }
                                  ]
                                },
                                {
                                  '@type': 'DigitalDocumentPermission',
                                  permissionType: 'ViewIdentityPermission',
                                  grantee: {
                                    '@type': 'Audience',
                                    audienceType: 'editor'
                                  },
                                  permissionScope: {
                                    '@type': 'Audience',
                                    audienceType: 'editor'
                                  }
                                }
                              ]
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
                          auth: authorAuth,
                          json: Object.assign({}, defaultCreateGraphAction, {
                            actionStatus: 'CompletedActionStatus',
                            agent: getId(author),
                            participant: getId(arrayify(periodical.editor)[0]),
                            result: {
                              '@id': createId('graph', uuid.v4())['@id'],
                              '@type': 'Graph',
                              mainEntity: '_:article',
                              author: {
                                roleName: 'author',
                                author: getId(author)
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
        });
      });
    });
  });

  it('should replicate the content of the CouchDB database into PouchDB and anonymize in the replication proxy', () => {
    const authorization =
      'Basic ' +
      Buffer.from(`${auth.username}:${auth.password}`).toString('base64');

    const db = new PouchDB(`test-db-${uuid.v4()}`, {
      adapter: 'memory',
      fetch: function(url, opts) {
        opts.headers.set('Authorization', authorization);
        return PouchDB.fetch(url, opts);
      }
    });

    const remote = new PouchDB(couchRemoteUrl, {
      fetch: function(url, opts) {
        opts.headers.set('Authorization', authorization);
        opts.headers.set('X-PouchDB', 'true');
        return PouchDB.fetch(url, opts);
      }
    });

    return db.replicate
      .from(remote)
      .then(res => {
        return db.allDocs({ include_docs: true });
      })
      .then(res => {
        const docs = res.rows.map(row => row.doc);
        const agraph = docs.find(doc => getId(doc) === getId(graph));
        assert(
          getId(agraph.author.author).startsWith('anon:'),
          `${getId(graph.author.author)} instead of anon:`
        );
      })
      .catch(err => {
        console.error(err);
        throw err;
      });
  });

  after(() => {
    server.destroy();
  });
});
