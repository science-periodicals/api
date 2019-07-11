import assert from 'assert';
import uuid from 'uuid';
import { unprefix, getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { SCIPE_EXPLORER_OFFER_ID } from '@scipe/librarian';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';
import registerUser from './utils/register-user';

describe('Stripe', function() {
  this.timeout(40000);

  let server, user, auth, organization, accountId, customerId, subscriptionId;

  before(function(done) {
    server = createServer({ rateLimiterPoints: 100 });
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
            if ((err = createError(err, resp, body))) {
              return done(err);
            }

            organization = body.result;

            client.post(
              {
                url: '/action',
                auth,
                json: {
                  '@type': 'CreatePaymentAccountAction',
                  agent: getId(user),
                  actionStatus: 'CompletedActionStatus',
                  object: getId(organization),
                  result: {
                    country: 'US',
                    external_account: {
                      object: 'bank_account',
                      country: 'US',
                      currency: 'usd',
                      // see https://stripe.com/docs/connect/testing#account-numbers
                      routing_number: '110000000',
                      account_number: '000123456789'
                    }
                  }
                }
              },
              (err, resp, body) => {
                if ((err = createError(err, resp, body))) {
                  return done(err);
                }

                accountId = getId(body.result);

                client.post(
                  {
                    url: '/action',
                    auth,
                    json: {
                      '@type': 'CreateCustomerAccountAction',
                      agent: getId(user),
                      actionStatus: 'CompletedActionStatus',
                      object: getId(organization)
                    }
                  },
                  (err, resp, body) => {
                    if ((err = createError(err, resp, body))) {
                      return done(err);
                    }

                    customerId = getId(body.result);

                    client.post(
                      {
                        url: '/action',
                        auth,
                        json: {
                          '@type': 'SubscribeAction',
                          agent: getId(user),
                          actionStatus: 'ActiveActionStatus',
                          instrument: getId(organization),
                          object: 'service:scienceai',
                          expectsAcceptanceOf: SCIPE_EXPLORER_OFFER_ID,
                          paymentToken: {
                            '@type': 'PaymentToken',
                            value: 'tok_visa' // see https://stripe.com/docs/testing#cards
                          }
                        }
                      },
                      (err, resp, body) => {
                        if ((err = createError(err, resp, body))) {
                          return done(err);
                        }

                        subscriptionId = getId(body.result);

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

  it('should get a stripe account by providing an organization id', done => {
    client.get(
      {
        url: '/stripe/account',
        qs: {
          organization: unprefix(getId(organization))
        },
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        // console.log(require('util').inspect(body, { depth: null }));
        assert.equal(body.id, unprefix(accountId));

        done();
      }
    );
  });

  it('should get a stripe account by id', done => {
    client.get(
      {
        url: `/stripe/${unprefix(accountId)}`,
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        // console.log(require('util').inspect(body, { depth: null }));
        assert.equal(body.id, unprefix(accountId));

        done();
      }
    );
  });

  it('should get a stripe customer by providing an organization id', done => {
    client.get(
      {
        url: '/stripe/customer',
        qs: {
          organization: unprefix(getId(organization))
        },
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        // console.log(require('util').inspect(body, { depth: null }));
        assert.equal(body.id, unprefix(customerId));

        done();
      }
    );
  });

  it('should get a stripe customer by id', done => {
    client.get(
      {
        url: `/stripe/${unprefix(customerId)}`,
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        // console.log(require('util').inspect(body, { depth: null }));
        assert.equal(body.id, unprefix(customerId));

        done();
      }
    );
  });

  it('should get an active `SubscribeAction` by providing an organization id', done => {
    client.get(
      {
        url: '/stripe/subscription',
        qs: {
          organization: unprefix(getId(organization))
        },
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        // console.log(require('util').inspect(body, { depth: null }));
        assert.equal(getId(body.result), subscriptionId);

        done();
      }
    );
  });

  it('should get a stripe subscription by id', done => {
    client.get(
      {
        url: `/stripe/${unprefix(subscriptionId)}`,
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        // console.log(require('util').inspect(body, { depth: null }));
        assert.equal(body.id, unprefix(subscriptionId));

        done();
      }
    );
  });

  after(done => {
    client.delete(
      {
        url: `/organization/${unprefix(getId(organization))}`,
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        server.destroy();
        done();
      }
    );
  });
});
