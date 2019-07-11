import assert from 'assert';
import createError from '@scipe/create-error';
import path from 'path';
import fs from 'fs';
import uuid from 'uuid';
import {
  createId,
  getDefaultPeriodicalDigitalDocumentPermissions,
  getDefaultGraphDigitalDocumentPermissions,
  ALL_AUDIENCES,
  ASSET_LOGO,
  CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE
} from '@scipe/librarian';
import { arrayify, getId, unprefix } from '@scipe/jsonld';
import zmq from 'zeromq';
import { client, portHttp } from './utils/config';
import registerUser from './utils/register-user';
import createServer from './utils/create-server';

describe('encodings', function() {
  this.timeout(80000);

  let server, sock, author, editor, organization;

  before(function(done) {
    server = createServer({ skipPayments: true, rateLimiterPoints: 100 });
    server.listen(portHttp, () => {
      registerUser((err, user, auth) => {
        if (err) return done(err);
        author = { user, auth };

        registerUser((err, user, auth) => {
          if (err) return done(err);
          editor = { user, auth };

          client.post(
            {
              url: '/action',
              auth: editor.auth,
              json: {
                '@type': 'CreateOrganizationAction',
                agent: editor.user,
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

              const addr =
                process.env.WORKER_BROKER_FRONTEND || 'tcp://127.0.0.1:3003';
              sock = zmq.socket('rep');
              sock.bind(addr, done);
            }
          );
        });
      });
    });
  });

  describe('graph encodings', () => {
    const workflowSpecification = {
      '@type': 'WorkflowSpecification',
      expectedDuration: 'P60D',
      potentialAction: {
        '@type': 'CreateGraphAction',
        result: {
          '@type': 'Graph',
          hasDigitalDocumentPermission: getDefaultGraphDigitalDocumentPermissions(),
          potentialAction: {
            '@type': 'StartWorkflowStageAction',
            participant: ALL_AUDIENCES,
            result: {
              '@type': 'CreateReleaseAction',
              actionStatus: 'ActiveActionStatus',
              agent: {
                roleName: 'author'
              },
              participant: [
                {
                  '@type': 'Audience',
                  audienceType: 'author'
                },
                {
                  '@type': 'Audience',
                  audienceType: 'editor'
                }
              ],
              result: {
                '@type': 'Graph',
                potentialAction: {
                  '@type': 'PublishAction',
                  agent: {
                    roleName: 'editor'
                  },
                  participant: {
                    '@type': 'Audience',
                    audienceType: 'editor'
                  }
                }
              }
            }
          }
        }
      }
    };

    describe('private graph encodings', () => {
      let periodical, graph, createReleaseAction, uploadAction;
      before(done => {
        client.post(
          {
            url: '/action',
            auth: editor.auth,
            json: {
              '@type': 'CreatePeriodicalAction',
              agent: getId(editor.user),
              actionStatus: 'CompletedActionStatus',
              object: getId(organization),
              result: {
                '@id': createId('journal', uuid.v4())['@id'],
                '@type': 'Periodical',
                name: 'my journal',
                hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
                  editor.user,
                  { createGraphPermission: true }
                ),
                editor: {
                  '@type': 'ContributorRole',
                  roleName: 'editor',
                  editor: getId(editor.user)
                },
                producer: {
                  '@type': 'ContributorRole',
                  roleName: 'producer',
                  producer: getId(editor.user)
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
                auth: editor.auth,
                json: {
                  '@type': 'CreateWorkflowSpecificationAction',
                  agent: getId(editor.user),
                  object: getId(periodical),
                  result: workflowSpecification
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
                    auth: author.auth,
                    json: Object.assign({}, defaultCreateGraphAction, {
                      actionStatus: 'CompletedActionStatus',
                      agent: getId(author.user),
                      participant: getId(arrayify(periodical.editor)[0]),
                      result: {
                        '@id': createId('graph', uuid.v4())['@id'],
                        '@type': 'Graph',
                        mainEntity: '_:article',
                        editor: getId(arrayify(periodical.editor)[0]),
                        author: {
                          roleName: 'author',
                          author: getId(author.user)
                        },
                        '@graph': [
                          {
                            '@id': '_:article',
                            '@type': 'Dataset'
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

                    createReleaseAction = graph.potentialAction.find(
                      action => action['@type'] === 'CreateReleaseAction'
                    );
                    fs.readFile(
                      path.join(__dirname, 'fixtures', 'data-csv.csv'),
                      { encoding: 'utf8' },
                      (err, data) => {
                        if (err) console.error(err);
                        client.post(
                          {
                            url: '/encoding',
                            headers: {
                              'Content-Type': 'text/csv'
                            },
                            auth: author.auth,
                            qs: {
                              name: 'data.csv',
                              context: createReleaseAction['@id'],
                              resource: getId(
                                graph['@graph'].find(
                                  node => node['@type'] === 'Dataset'
                                )
                              )
                            },
                            body: data
                          },
                          (err, resp, body) => {
                            if ((err = createError(err, resp, body))) {
                              return done(err);
                            }
                            uploadAction = JSON.parse(body);

                            // we merge the encoding
                            client.post(
                              {
                                url: '/action',
                                auth: author.auth,
                                json: {
                                  '@type': 'UpdateAction',
                                  instrumentOf: getId(createReleaseAction),
                                  actionStatus: 'CompletedActionStatus',
                                  agent: getId(arrayify(graph.author)[0]),
                                  mergeStrategy: 'ReconcileMergeStrategy',
                                  object: getId(uploadAction),
                                  targetCollection: getId(graph)
                                }
                              },
                              (err, resp, body) => {
                                if ((err = createError(err, resp, body))) {
                                  return done(err);
                                }
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

      it('should have POSTed an encoding and prevent the re-upload of the same file (based on the checksum)', done => {
        // console.log(
        //   require('util').inspect(uploadAction, { depth: null })
        // );
        const encoding = uploadAction.result;
        assert.equal(encoding['@type'], 'DataDownload');
        assert(encoding['@id'], 'encodingId was generated');
        assert(encoding.encodesCreativeWork, 'resource was generated');

        // try to put it again and get a 403

        fs.readFile(
          path.join(__dirname, 'fixtures', 'data-csv.csv'),
          { encoding: 'utf8' },
          (err, data) => {
            if (err) return done(err);
            client.post(
              {
                url: '/encoding',
                headers: {
                  'Content-Type': 'text/csv'
                },
                auth: editor.auth,
                qs: {
                  name: 'data.csv',
                  context: createReleaseAction['@id'],
                  resource: getId(encoding.encodesCreativeWork)
                },
                body: data
              },
              (err, resp, body) => {
                if (err) {
                  return done(err);
                }

                assert.equal(resp.statusCode, 403);
                done();
              }
            );
          }
        );
      });

      it('should get the encoding (and automatically decompress it)', done => {
        const encoding = uploadAction.result;
        client.get(
          {
            url: encoding.contentUrl,
            auth: editor.auth
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return done(err);
            }
            assert.equal(resp.statusCode, 200);
            assert(/a/.test(body));
            done();
          }
        );
      });
    });

    describe('public graph encodings', () => {
      let periodical, graph, encoding;
      before(done => {
        client.post(
          {
            url: '/action',
            auth: editor.auth,
            json: {
              '@type': 'CreatePeriodicalAction',
              agent: getId(editor.user),
              actionStatus: 'CompletedActionStatus',
              object: getId(organization),
              result: {
                '@id': createId('journal', uuid.v4())['@id'],
                '@type': 'Periodical',
                name: 'my journal',
                hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
                  editor.user,
                  { createGraphPermission: true, publicReadPermission: true }
                ),
                editor: {
                  '@type': 'ContributorRole',
                  roleName: 'editor',
                  editor: getId(editor.user)
                },
                producer: {
                  '@type': 'ContributorRole',
                  roleName: 'producer',
                  producer: getId(editor.user)
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
                auth: editor.auth,
                json: {
                  '@type': 'CreateWorkflowSpecificationAction',
                  agent: getId(editor.user),
                  object: getId(periodical),
                  result: workflowSpecification
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
                    auth: author.auth,
                    json: Object.assign({}, defaultCreateGraphAction, {
                      actionStatus: 'CompletedActionStatus',
                      agent: getId(author.user),
                      participant: [
                        getId(arrayify(periodical.editor)[0]),
                        getId(arrayify(periodical.producer)[0])
                      ],
                      result: {
                        '@id': createId('graph', uuid.v4())['@id'],
                        '@type': 'Graph',
                        mainEntity: '_:article',
                        editor: getId(arrayify(periodical.editor)[0]),
                        producer: getId(arrayify(periodical.producer)[0]),
                        author: {
                          roleName: 'editor',
                          author: getId(author.user)
                        },
                        '@graph': [
                          {
                            '@id': '_:article',
                            '@type': 'Dataset'
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

                    const createReleaseAction = graph.potentialAction.find(
                      action => action['@type'] === 'CreateReleaseAction'
                    );
                    fs.readFile(
                      path.join(__dirname, 'fixtures', 'data-csv.csv'),
                      { encoding: 'utf8' },
                      (err, data) => {
                        if (err) console.error(err);
                        client.post(
                          {
                            url: '/encoding',
                            headers: {
                              'Content-Type': 'text/csv'
                            },
                            auth: author.auth,
                            qs: {
                              name: 'data.csv',
                              context: createReleaseAction['@id'],
                              resource: getId(
                                graph['@graph'].find(
                                  node => node['@type'] === 'Dataset'
                                )
                              ),
                              compress: false // set to false so that we can test the Range support
                            },
                            body: data
                          },
                          (err, resp, body) => {
                            if ((err = createError(err, resp, body))) {
                              return done(err);
                            }
                            const uploadAction = JSON.parse(body);

                            // we merge the encoding
                            client.post(
                              {
                                url: '/action',
                                auth: author.auth,
                                json: {
                                  '@type': 'UpdateAction',
                                  instrumentOf: getId(createReleaseAction),
                                  actionStatus: 'CompletedActionStatus',
                                  agent: getId(arrayify(graph.author)[0]),
                                  mergeStrategy: 'ReconcileMergeStrategy',
                                  object: getId(uploadAction),
                                  targetCollection: getId(graph)
                                }
                              },
                              (err, resp, body) => {
                                if ((err = createError(err, resp, body))) {
                                  return done(err);
                                }

                                // cut the release
                                client.post(
                                  {
                                    url: '/action',
                                    auth: author.auth,
                                    json: Object.assign(
                                      {},
                                      createReleaseAction,
                                      {
                                        actionStatus: 'CompletedActionStatus',
                                        agent: getId(arrayify(graph.author)[0])
                                      }
                                    )
                                  },
                                  (err, resp, body) => {
                                    if ((err = createError(err, resp, body))) {
                                      return done(err);
                                    }

                                    // we release the graph publicly
                                    const publishAction = graph.potentialAction.find(
                                      action =>
                                        action['@type'] === 'PublishAction'
                                    );

                                    client.post(
                                      {
                                        url: '/action',
                                        auth: editor.auth,
                                        json: Object.assign({}, publishAction, {
                                          actionStatus: 'CompletedActionStatus',
                                          agent: getId(
                                            arrayify(graph.editor)[0]
                                          )
                                        })
                                      },
                                      (err, resp, body) => {
                                        if (
                                          (err = createError(err, resp, body))
                                        ) {
                                          return done(err);
                                        }

                                        //  console.log(
                                        //    require('util').inspect(body, {
                                        //      depth: null
                                        //    })
                                        //  );

                                        graph = body.result;
                                        const encodingId = arrayify(
                                          graph['@graph'].find(
                                            node => node['@type'] === 'Dataset'
                                          ).distribution
                                        )[0];
                                        encoding = graph['@graph'].find(
                                          node => getId(node) === encodingId
                                        );
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
              }
            );
          }
        );
      });

      it('should get a public encoding with no auth', done => {
        client.get(
          {
            url: encoding.contentUrl
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) return done(err);
            assert.equal(resp.statusCode, 200);
            assert(/a/.test(body));
            done();
          }
        );
      });

      it('should get a public encoding with ranges', done => {
        client.get(
          {
            url: encoding.contentUrl,
            headers: {
              range: 'bytes=0-1'
            }
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return done(err);
            }

            assert.equal(resp.statusCode, 206);
            assert.equal(
              resp.headers['accept-ranges'],
              'bytes',
              'Accept-Ranges is bytes'
            );
            assert.equal(
              resp.headers['content-range'],
              'bytes 0-1/266',
              'Content-Range is 0-1/266'
            );
            assert.equal(
              resp.headers['content-length'],
              '2',
              'Content-Length is 2'
            );
            assert.equal(body, '"a', 'body is exactly `"a`');

            client.get(
              {
                url: encoding.contentUrl,
                headers: {
                  range: 'bytes=12-'
                }
              },
              (err, resp, body) => {
                if ((err = createError(err, resp, body))) return done(err);
                assert.equal(resp.statusCode, 206);
                assert(/^1,2,3/.test(body), 'skipped CSV headers');
                done();
              }
            );
          }
        );
      });

      it('should have the right caching headers and behaviour', done => {
        client.get(
          {
            url: encoding.contentUrl
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) return done(err);
            assert.equal(resp.statusCode, 200);
            assert.equal(
              resp.headers['cache-control'],
              'max-age=31536000000, public, immutable',
              'Cache-Control'
            );
            assert.equal(resp.headers.etag, `"${encoding['@id']}"`, 'ETag');
            client.get(
              {
                url: encoding.contentUrl,
                headers: {
                  'if-none-match': `"${encoding['@id']}"`
                }
              },
              (err, resp, body) => {
                if ((err = createError(err, resp, body))) return done(err);
                assert.equal(resp.statusCode, 304);
                assert.equal(body.length, 0, 'no body');
                done();
              }
            );
          }
        );
      });
    });
  });

  describe('asset encodings', () => {
    let periodical;
    before(done => {
      client.post(
        {
          url: '/action',
          auth: editor.auth,
          json: {
            '@type': 'CreatePeriodicalAction',
            agent: getId(editor.user),
            actionStatus: 'CompletedActionStatus',
            object: getId(organization),
            result: {
              '@id': createId('journal', uuid.v4())['@id'],
              '@type': 'Periodical',
              name: 'my journal',
              hasDigitalDocumentPermission: getDefaultPeriodicalDigitalDocumentPermissions(
                editor.user,
                { createGraphPermission: true }
              ),
              editor: {
                '@type': 'ContributorRole',
                roleName: 'editor',
                editor: getId(editor.user)
              }
            }
          }
        },
        (err, resp, body) => {
          if ((err = createError(err, resp, body))) {
            return done(err);
          }

          periodical = body.result;

          // add a resource logo to the periodical
          client.post(
            {
              url: '/action',
              auth: editor.auth,
              json: {
                '@type': 'UpdateAction',
                agent: getId(editor.user),
                actionStatus: 'CompletedActionStatus',
                object: {
                  '@type': 'Image',
                  name: ASSET_LOGO
                },
                targetCollection: {
                  '@type': 'TargetRole',
                  targetCollection: getId(periodical),
                  hasSelector: {
                    '@type': 'NodeSelector',
                    selectedProperty: 'logo'
                  }
                }
              }
            },
            (err, resp, body) => {
              if ((err = createError(err, resp, body))) {
                return done(err);
              }

              periodical = body.result;
              done();
            }
          );
        }
      );
    });

    describe('property encodings (logo etc.)', () => {
      let encoding;

      before(done => {
        fs.readFile(
          path.join(__dirname, 'fixtures', 'image.jpg'),
          (err, data) => {
            if (err) return done(err);

            sock.once('message', action => {
              action = JSON.parse(action);
              assert.equal(action['@type'], 'ImageProcessingAction');
              assert.equal(action.object['@type'], 'ImageObject');
              sock.send([JSON.stringify(action), 'fakeWorkerId']);
            });

            client.post(
              {
                url: '/encoding',
                headers: {
                  'Content-Type': 'image/jpeg'
                },
                auth: editor.auth,
                qs: {
                  name: 'image.jpeg',
                  context: periodical['@id'],
                  resource: getId(arrayify(periodical.logo)[0])
                },
                body: data
              },
              (err, resp, body) => {
                if ((err = createError(err, resp, body))) {
                  return done(err);
                }
                const uploadAction = JSON.parse(body);
                encoding = uploadAction.result;

                done();
              }
            );
          }
        );
      });

      it('should have uploaded the logo', () => {
        assert.equal(encoding['@type'], 'ImageObject');
        assert(getId(encoding.isNodeOf));

        assert.equal(
          encoding.potentialAction['@type'],
          'ImageProcessingAction'
        );
      });

      it('should get the uploaded logo (before it is committed to the periodical)', done => {
        client.get(
          {
            url: `/encoding/${unprefix(getId(encoding))}`,
            auth: editor.auth
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return done(err);
            }
            assert.equal(resp.statusCode, 200);
            done();
          }
        );
      });
    });

    describe('style encodings', () => {
      let style, uploadAction, encoding;
      before(done => {
        // add a style to the periodical
        client.post(
          {
            url: '/action',
            auth: editor.auth,
            json: {
              '@type': 'UpdateAction',
              agent: getId(editor.user),
              actionStatus: 'CompletedActionStatus',
              object: {
                '@type': 'CssVariable',
                name: CSS_VARIABLE_LARGE_BANNER_BACKGROUND_IMAGE
              },
              targetCollection: {
                '@type': 'TargetRole',
                targetCollection: getId(periodical),
                hasSelector: {
                  '@type': 'NodeSelector',
                  selectedProperty: 'style'
                }
              }
            }
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return done(err);
            }
            style = arrayify(body.result.style)[0];

            fs.readFile(
              path.join(__dirname, 'fixtures', 'image.jpg'),
              (err, data) => {
                if (err) return done(err);

                sock.once('message', action => {
                  action = JSON.parse(action);
                  assert.equal(action['@type'], 'ImageProcessingAction');
                  assert.equal(action.object['@type'], 'ImageObject');
                  sock.send([JSON.stringify(action), 'fakeWorkerId']);
                });

                client.post(
                  {
                    url: '/encoding',
                    headers: {
                      'Content-Type': 'image/jpeg'
                    },
                    auth: editor.auth,
                    qs: {
                      name: 'image.jpeg',
                      context: getId(periodical),
                      resource: getId(style)
                    },
                    body: data
                  },
                  (err, resp, body) => {
                    if ((err = createError(err, resp, body))) {
                      return done(err);
                    }
                    uploadAction = JSON.parse(body);
                    encoding = uploadAction.result;

                    // console.log(
                    //   require('util').inspect(uploadAction, { depth: null })
                    // );

                    done();
                  }
                );
              }
            );
          }
        );
      });

      it('should have uploaded the style encoding', () => {
        assert.equal(encoding['@type'], 'ImageObject');
        assert(getId(encoding.encodesCreativeWork));
        assert.equal(
          encoding.potentialAction['@type'],
          'ImageProcessingAction'
        );
      });

      it('should get the style encoding (before it is committed to the periodical)', done => {
        client.get(
          {
            url: encoding.contentUrl,
            auth: editor.auth
          },
          (err, resp, body) => {
            if ((err = createError(err, resp, body))) {
              return done(err);
            }
            assert.equal(resp.statusCode, 200);
            done();
          }
        );
      });
    });
  });

  after(done => {
    server.destroy();
    sock.close();
    setTimeout(done, 100);
  });
});
