import { Router } from 'express';
import createError from '@scipe/create-error';
import { contextLink, getId } from '@scipe/jsonld';
import { addLibrarian, parseQuery } from '../middlewares/librarian';

const router = new Router({ caseSensitive: true });

// Note: ACL is a special case for invoices are there are not proper document
// we just generate them on the fly from stripe data

/**
 * Get an invoice by @id
 */
router.get('/:invoiceId', addLibrarian, parseQuery, (req, res, next) => {
  res.set('Link', contextLink);

  const invoiceId = `invoice:${req.params.invoiceId}`;

  // we need the organization @id to do the ACL
  req.librarian.getInvoice(invoiceId, (err, invoice) => {
    if (err) return next(err);
    const organizationId = getId(invoice.customer);

    req.librarian.checkAcl({ docs: [organizationId] }, (err, check) => {
      if (err) return next(err);
      if (!check.isAdmin && !check([organizationId, 'AdminPermission'])) {
        return next(
          createError(
            403,
            `Forbidden to access ${invoiceId}. You need Organization admin rights to access invoices`
          )
        );
      }

      res.set('Link', contextLink);
      res.json(invoice);
    });
  });
});

/**
 * List invoices
 * ?organization=organizationId is required
 * Note: ?upcoming=true returns the upcoming invoice
 */
router.get('/', addLibrarian, parseQuery, (req, res, next) => {
  const { organization, upcoming, limit, startingAfter } = req.query;

  if (!organization) {
    return next(
      createError(400, 'Missing organization query string parameter')
    );
  }

  // ACL
  const organizationId = `org:${organization}`;

  req.librarian.checkAcl({ docs: [organizationId] }, (err, check) => {
    if (err) return next(err);
    if (!check.isAdmin && !check([organizationId, 'AdminPermission'])) {
      return next(
        createError(
          403,
          `Forbidden. You need Organization admin rights to access invoices`
        )
      );
    }

    if (upcoming) {
      req.librarian.getUpcomingInvoice(organizationId, (err, invoice) => {
        if (err) return next(err);
        res.set('Link', contextLink);
        res.json(invoice);
      });
    } else {
      req.librarian.getInvoices(
        organizationId,
        {
          limit,
          startingAfter,
          format: 'SearchResultList',
          baseUrl: `${req.protocol}://${req.headers.host}${req.baseUrl}${
            req.path
          }`
        },
        (err, invoices) => {
          if (err) return next(err);
          res.set('Link', contextLink);
          res.json(invoices);
        }
      );
    }
  });
});

export default router;
