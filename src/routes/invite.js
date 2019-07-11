import { Router } from 'express';

const router = new Router({ caseSensitive: true });

// TODO update

/**
 * This is used to support accepting invites from email to emit invite etc. see POST /action/:actionId
 */
router.get('/invite', (req, res, next) => {});
