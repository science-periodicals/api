import assert from 'assert';
import uuid from 'uuid';
import { unprefix, getId } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { SCIPE_EXPLORER_OFFER_ID } from '@scipe/librarian';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';
import registerUser from './utils/register-user';

describe('Invoice', function() {
  this.timeout(40000);

  let server, user, auth, organization;

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

                done();
              }
            );
          }
        );
      });
    });
  });

  it('should retrieve the upcoming invoice', done => {
    client.get(
      {
        url: `/invoice`,
        qs: {
          organization: unprefix(getId(organization)),
          upcoming: true
        },
        auth,
        json: true
      },
      (err, resp, body) => {
        if ((err = createError(err, resp, body))) {
          return done(err);
        }

        // console.log(require('util').inspect(body, { depth: null }));
        assert.equal(body['@type'], 'Invoice');

        done();
      }
    );
  });

  it('should list the existing invoices', done => {
    client.get(
      {
        url: `/invoice`,
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
        assert.equal(body['@type'], 'SearchResultList');

        done();
      }
    );
  });

  it('should get an invoice by @id', done => {
    client.get(
      {
        url: `/invoice`,
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

        const invoice = body.itemListElement[0].item;

        client.get(
          {
            url: `/invoice/${unprefix(getId(invoice))}`,
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
            assert.equal(body['@type'], 'Invoice');
            assert.equal(getId(body), getId(invoice));

            done();
          }
        );
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
