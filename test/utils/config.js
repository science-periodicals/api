import request from 'request';
import util from 'util';

export const host = process.env.HOST || '127.0.0.1';
export const portHttp = process.env.PORT_HTTP || 3084;
export const client = request.defaults({
  baseUrl: 'http://' + host + ':' + portHttp
});
export const admin = request.defaults({
  baseUrl: util.format(
    '%s//%s:%s@%s:%d/',
    process.env.COUCH_PROTOCOL || 'http:',
    process.env.COUCH_ADMIN_USERNAME || 'admin',
    process.env.COUCH_ADMIN_PASSWORD || 'admin',
    process.env.COUCH_HOST || '127.0.0.1',
    process.env.COUCH_PORT || 5984
  )
});
export const dbName = process.env.DB_NAME || 'scienceai';
export const dbVersion = process.env.DB_VERSION || '';
export const couchAuthDb = process.env.COUCH_AUTH_DB || '_users';
export const couchRemoteUrl = `http://${host}:${portHttp}/${dbName}__${dbVersion}__`;

export const apiKey = process.env.SCIENCEAI_API_KEY || 'scienceai_api_key';
export const apiSecret =
  process.env.SCIENCEAI_API_SECRET || 'scienceai_api_secret';
