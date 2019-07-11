import { RateLimiterRedis } from 'rate-limiter-flexible';
import { createRedisClient } from '@scipe/librarian';

export default function createRateLimiter(config) {
  const redisClient = createRedisClient(config, { redisOfflineQueue: false });

  const rateLimiter = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: config.rateLimiterKeyPrefix || 'rlfxbl',
    points: config.rateLimiterPoints || 100, // number of requests !! this need to be large enough for the /encoding route (an article can have a lot of figures or equations)
    duration: config.rateLimiterDuration || 1 // per second by IP
  });

  return function rateLimiterMiddleware(req, res, next) {
    rateLimiter
      .consume(req.connection.remoteAddress)
      .then(() => {
        next();
      })
      .catch(() => {
        res.status(429).send('Too Many Requests');
      });
  };
}
