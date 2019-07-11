# API

[![CircleCI](https://circleci.com/gh/science-periodicals/api.svg?style=svg&circle-token=a379c00101a66909a1c55c6f6ac8db94bd5af335)](https://circleci.com/gh/science-periodicals/api)

[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

sci.pe Hypermedia API

Note: this module is auto published to npm on CircleCI. Only run `npm version
patch|minor|major` and let CI do the rest.

## Coding style

Use `prettier --single-quote` (or `npm run format`) and:
- `const` over `let` or `var` whenever possible


## Development

Be sure that CouchDB and Redis are running.
To link see `link.sh`

For tests:

```sh
npm test
```

## Documentation

See [https://sci.pe/get-started/api](https://sci.pe/get-started/api).

## API

```js
import { api, assets } from '@scipe/api';

const app = express();

app.use(assets(config));
app.use(api(config));
```

### Middlewares


#### addLibrarian

```js
import { addLibrarian } from '@scipe/api';
import express from 'express';
const app = express();
app.get('/:id', addLibrarian, (req, res, next) => {
  req.pipe(req.librarian.db.get(req.params.id)).pipe(res);
});
```

#### acl

```js
import { acl } from '@scipe/api';
import express from 'express';
const app = express();

app.get('/', acl(), (req, res, next) => {
  // user has access
});
```

## License

`@scipe/api` is dual-licensed under commercial and open source licenses
([AGPLv3](https://www.gnu.org/licenses/agpl-3.0.en.html)) based on the intended
use case. Contact us to learn which license applies to your use case.
