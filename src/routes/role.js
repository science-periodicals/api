import { Router } from 'express';
import pick from 'lodash/pick';
import createError from '@scipe/create-error';
import { contextUrl, contextLink, getId, getNodeMap } from '@scipe/jsonld';
import {
  encrypt,
  getRootPartId,
  getActiveRoles,
  getAgentId,
  parseUsername
} from '@scipe/librarian';
import { addLibrarian, parseQuery } from '../middlewares/librarian';

const router = new Router({ caseSensitive: true });

// Note: we currently do not cache role routes as we don't have a good concept of
// "scope" for those yet

/**
 * Get a role by @id
 */
router.get('/:roleId', addLibrarian, parseQuery, (req, res, next) => {
  req.librarian.get(
    `role:${req.params.roleId}`,
    {
      acl: req.app.locals.config.acl,
      potentialActions: req.query.potentialActions,
      anonymize: req.app.locals.config.anonymize
    },
    (err, doc) => {
      if (err) return next(err);
      res.set('Link', contextLink);
      res.json(doc);
    }
  );
});

/**
 * Search for roles
 * !!! Note that for now this only work with specific qs:
 * - to find anonymized journal staff (MUST be used with the qs:
 * `?anonymize=true&graph=graphId&roleName=reviewer|editor|producer`)
 * - to list all the roles of a user id (MUST be used with the qs:
 * `?user=username`
 */
router.get('/', addLibrarian, parseQuery, async (req, res, next) => {
  const {
    librarian,
    query: { anonymize, graph: unprefixedGraphId, roleName, user: username }
  } = req;

  if (
    !username &&
    !(
      anonymize &&
      unprefixedGraphId &&
      (roleName === 'reviewer' ||
        roleName === 'editor' ||
        roleName === 'producer')
    )
  ) {
    return next(
      createError(
        400,
        'Invalid query string parameters, either `user` must be set or `anonymize` must be set to "true", `journal` to an existing (unprefixed) "journalId" `graph` to an existing (unprefixed) "graphId" and `roleName` to "reviewer" "producer" or "editor"'
      )
    );
  }

  if (username) {
    // list all the roles of a user id
    const userId = `user:${username}`;
    try {
      const roles = await librarian.getUserRoles(userId, {
        acl: req.app.locals.config.acl,
        anonymize: req.app.locals.config.anonymize
      });

      const payload = {
        '@context': contextUrl,
        '@type': 'SearchResultList',
        numberOfItems: roles.length,
        itemListOrder: 'random',
        itemListElement: roles.map(role => {
          return {
            '@type': 'ListItem',
            item: role
          };
        })
      };

      let viewer;
      let viewerUsername = parseUsername(req);
      if (req.session && req.session.userId) {
        viewer = req.session.userId;
      } else if (viewerUsername) {
        viewer = `user:${username}`;
      } else {
        viewer = { '@type': 'Audience', audienceType: 'public' };
      }

      const anonymizedPayload = await librarian.anonymize(payload, {
        viewer,
        correlatedRoleIds: true,
        anonymize: req.app.locals.config.anonymize
      });

      res.set('Link', contextLink);
      res.json(anonymizedPayload);
    } catch (err) {
      return next(err);
    }
  } else {
    // find anonymized journal staff

    try {
      const graph = await librarian.get(`graph:${unprefixedGraphId}`, {
        acl: req.app.locals.config.acl,
        anonymize: false
      });

      const journal = await librarian.get(getRootPartId(graph), {
        acl: false,
        anonymize: false
      });

      let roles = getActiveRoles(journal).filter(
        role => role.roleName === roleName
      );

      if (anonymize) {
        // We grab the subjects (`knowsAbout`) from user profiles as client side will do search based on subjects
        const userIds = Array.from(
          new Set(
            roles
              .map(role => getAgentId(role))
              .filter(id => id && id.startsWith('user:'))
          )
        );

        const profiles = await librarian.get(userIds, { acl: false }); // TODO optimize with _all_docs ?
        const profileMap = getNodeMap(profiles);

        roles = roles
          .map(role => {
            // embed profile subjects (`knowsAbout`) and `@type`
            const anonymizedRole = {
              '@id': `anon:${encrypt(
                getId(role),
                graph.encryptionKey
              )}?graph=${unprefixedGraphId}`,
              '@type': role['@type'],
              roleName,
              anonymizedName: `Anonymous ${roleName}`
            };

            const userId = getAgentId(role);
            if (userId && userId in profileMap) {
              const profile = profileMap[userId];
              anonymizedRole[roleName] = pick(profile, ['@type', 'knowsAbout']);
            }

            return anonymizedRole;
          })
          .sort((a, b) => {
            return getId(a).localeCompare(getId(b));
          });
      }

      res.set('Link', contextLink);
      res.json({
        '@context': contextUrl,
        '@type': 'SearchResultList',
        numberOfItems: roles.length,
        itemListOrder: 'random',
        itemListElement: roles.map(role => {
          return {
            '@type': 'ListItem',
            item: role
          };
        })
      });
    } catch (err) {
      next(err);
    }
  }
});

export default router;
