import assert from 'assert';
import uuid from 'uuid';
import split from 'split2';
import { getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import createServer from './utils/create-server';
import registerUser from './utils/register-user';
import { client, portHttp } from './utils/config';

describe('Changes feed', function() {
  this.timeout(80000);

  let server, user, auth, organization, periodical, lastEventID;

  // TODO implement info and start from there otherwise we miss the Register action
  // GET _changes?descending=true&limit=1&since=now
  before(function(done) {
    server = createServer({
      log: { name: 'api', level: 'error' },
      skipPayments: true,
      rateLimiterPoints: 100
    });
    server.listen(portHttp, () => {
      // we need to know where in the sequence space we need to start the changes feed.
      // We will start it after the user registration, so we listen to it to get the seq of that event

      registerUser(
        {
          '@id': `user:${uuid.v4()}`,
          email: `success+${uuid.v4()}@simulator.amazonses.com`,
          password: uuid.v4(),
          memberOf: 'acl:admin'
        },
        (err, _user, _auth) => {
          if (err) {
            return done(err);
          }
          user = _user;
          auth = _auth;

          client.get(
            {
              url: '/feed',
              json: true,
              auth: auth,
              qs: {
                limit: 1,
                filter: 'admin'
              }
            },
            (err, resp, body) => {
              if ((err = createError(err, resp, body))) {
                return done(err);
              }

              lastEventID = body.dataFeedElement[0]['@id'];

              // create a public journal to test public filter
              client.post(
                {
                  url: '/action',
                  auth,
                  json: {
                    '@type': 'CreateOrganizationAction',
                    agent: getId(user),
                    actionStatus: 'CompletedActionStatus',
                    result: {
                      '@id': `org:${uuid.v4()}`,
                      '@type': 'Organization',
                      name: 'org'
                    }
                  }
                },
                (err, resp, body) => {
                  if ((err = createError(err, resp, body))) {
                    return done(err);
                  }

                  organization = body.result;

                  client.post(
                    {
                      url: '/action',
                      auth: auth,
                      json: {
                        '@type': 'CreatePeriodicalAction',
                        actionStatus: 'CompletedActionStatus',
                        agent: {
                          roleName: 'author',
                          agent: user['@id']
                        },
                        object: getId(organization),
                        result: {
                          '@id': `journal:${uuid.v4()}`,
                          '@type': 'Periodical',
                          name: 'my journal',
                          hasDigitalDocumentPermission: [
                            {
                              '@type': 'DigitalDocumentPermission',
                              permissionType: 'CreateGraphPermission',
                              grantee: {
                                '@type': 'Audience',
                                audienceType: 'user'
                              }
                            },
                            {
                              '@type': 'DigitalDocumentPermission',
                              permissionType: 'ReadPermission',
                              grantee: {
                                '@type': 'Audience',
                                audienceType: 'public'
                              }
                            },
                            {
                              '@type': 'DigitalDocumentPermission',
                              permissionType: 'AdminPermission',
                              grantee: user['@id']
                            }
                          ]
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
            }
          );
        }
      );
    });
  });

  it('should have collected the lastEventID', () => {
    assert(lastEventID);
  });

  it('should get the public changes', done => {
    const r = client.get({
      url: '/feed',
      headers: {
        Accept: 'text/event-stream',
        'Last-Event-ID': lastEventID
      }
    });
    r.pipe(split())
      .on('data', _data => {
        let splt = _data.split(':');
        const type = splt.shift().trim();
        let data = splt.join(':').trim();
        if (type === 'data') {
          data = JSON.parse(data);
          if (data['@type'] === 'Periodical') {
            assert.equal(data['@type'], 'Periodical');
            r.abort();
          }
        }
      })
      .on('error', err => {
        console.error(err);
      })
      .on('end', done);
  });

  it('should get the user changes', done => {
    const r = client.get({
      url: '/feed',
      auth: auth,
      qs: {
        filter: 'user',
        outscope: JSON.stringify([
          'CreatePeriodicalAction',
          'CreateGraphAction',
          'CreateOrganizationAction'
        ])
      },
      headers: {
        Accept: 'text/event-stream',
        'Last-Event-ID': lastEventID
      }
    });
    r.pipe(split())
      .on('data', _data => {
        let splt = _data.split(':');
        const type = splt.shift().trim();
        let data = splt.join(':').trim();
        if (type === 'data') {
          data = JSON.parse(data);
          if (data['@type'] === 'CreatePeriodicalAction') {
            assert(data.result);
            r.abort();
          }
        }
      })
      .on('error', err => {
        console.error(err);
      })
      .on('end', done);
  });

  it('should get the scoped user changes', done => {
    const r = client.get({
      url: '/feed',
      auth: auth,
      qs: {
        filter: 'user',
        scope: periodical['@id'],
        outscope: JSON.stringify(['CreatePeriodicalAction'])
      },
      headers: {
        Accept: 'text/event-stream',
        'Last-Event-ID': lastEventID
      }
    });

    const seen = [];
    r.pipe(split())
      .on('data', _data => {
        let splt = _data.split(':');
        const type = splt.shift().trim();
        let data = splt.join(':').trim();

        if (type === 'data') {
          data = JSON.parse(data);
          seen.push(data);
          if (
            seen.every(
              doc =>
                doc['@type'] === 'Periodical' ||
                doc['@type'] === 'CreatePeriodicalAction'
            ) &&
            seen.some(doc => doc['@type'] === 'Periodical') &&
            seen.some(doc => doc['@type'] === 'CreatePeriodicalAction')
          ) {
            r.abort();
          }
        }
      })
      .on('error', err => {
        console.error(err);
      })
      .on('end', () => {
        assert.equal(seen.length, 2);
        done();
      });
  });

  it('should get the admin changes', done => {
    const r = client.get({
      url: '/feed',
      auth: auth,
      qs: {
        filter: 'admin'
      },
      headers: {
        Accept: 'text/event-stream',
        'Last-Event-ID': lastEventID
      }
    });

    let nEvents = 0;
    r.pipe(split())
      .on('data', _data => {
        let splt = _data.split(':');
        const type = splt.shift().trim();
        let data = splt.join(':').trim();
        if (type === 'data') {
          data = JSON.parse(data);
          nEvents++;
          if (data['@type'] === 'CreatePeriodicalAction') {
            r.abort();
          }
        }
      })
      .on('error', err => {
        console.error(err);
      })
      .on('end', () => {
        process.nextTick(() => {
          assert(nEvents >= 1);
          done();
        });
      });
  });

  after(() => {
    server.destroy();
  });
});
