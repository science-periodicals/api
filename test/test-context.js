import assert from 'assert';
import createServer from './utils/create-server';
import { client, portHttp } from './utils/config';

describe('JSON-LD context', function() {
  this.timeout(40000);

  let server;
  before(function(done) {
    server = createServer({ skipPayments: true, rateLimiterPoints: 100 });
    server.listen(portHttp, done);
  });

  it('should serve the context', done => {
    client.get(
      {
        url: '/',
        headers: {
          Accept: 'application/ld+json'
        }
      },
      (err, resp, body) => {
        assert.equal(resp.statusCode, 200);
        const ctx = JSON.parse(body);
        assert(ctx['@context']);
        done();
      }
    );
  });

  after(() => {
    server.destroy();
  });
});
