import uuid from 'uuid';
import { unprefix, getId } from '@scipe/jsonld';
import { Librarian, createId } from '@scipe/librarian';

export default function registerUser(user, callback) {
  const defaultUser = {
    '@id': `user:${uuid.v4()}`,
    name: 'peter',
    email: `mailto:success+${uuid.v4()}@simulator.amazonses.com`
  };

  if (!callback) {
    callback = user;
    user = defaultUser;
  } else {
    user = Object.assign(defaultUser, user);
  }

  let librarian = new Librarian();

  const tokenId = createId('token')['@id'];
  const password = uuid.v4();

  librarian.post(
    {
      '@type': 'RegisterAction',
      actionStatus: 'ActiveActionStatus',
      agent: user,
      instrument: {
        '@type': 'Password',
        value: password
      }
    },
    { tokenId, strict: false },
    (err, activeRegisterAction) => {
      if (err) return callback(err);

      librarian.post(
        Object.assign({}, activeRegisterAction, {
          actionStatus: 'CompletedActionStatus',
          instrument: {
            '@id': tokenId,
            '@type': 'Token',
            tokenType: 'registrationToken'
          }
        }),
        { strict: false },
        (err, completedRegisterAction) => {
          if (err) return callback(err);

          const user = completedRegisterAction.result;
          const auth = {
            username: unprefix(getId(user)),
            password: password
          };
          callback(null, user, auth);
        }
      );
    }
  );
}
