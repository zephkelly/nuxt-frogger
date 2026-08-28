/**
 * Reusable field-name lists. These are PROVIDED, never applied automatically —
 * compose them into rules via the {@link defineScrub} builder or a raw `rules`
 * array. Each entry is matched as a scrubber field pattern (plain string = exact
 * case-insensitive key match; RegExp = `.test()`).
 *
 * Note `NAME_FIELDS` intentionally omits the bare key `name`: it is far too
 * overloaded in telemetry (error.name, browser/vendor name, resource name) to
 * treat as a person's name. Opt in explicitly if you need it.
 */

import type { FieldPattern } from "./types";

export const PASSWORD_FIELDS: FieldPattern[] = [
    'password', 'passwd', 'pwd', 'secret',
    'apiKey', 'api_key', 'apikey',
    'token', 'accessToken', 'refreshToken',
    'privateKey', 'clientSecret',
    // Request-header names. These carry the two most valuable secrets a
    // request holds and were covered by no list at all, so an error report
    // that attached headers shipped them in plaintext.
    'cookie', 'set-cookie', 'setCookie',
    'authorization', 'proxy-authorization', 'proxyAuthorization',
    'x-api-key', 'x-auth-token', 'x-csrf-token',
    'bearer', 'sessionId', 'session_id',
]

export const EMAIL_FIELDS: FieldPattern[] = [
    'email', 'userEmail', 'emailAddress', 'e_mail',
    /.*email.*/i,
]

export const PHONE_FIELDS: FieldPattern[] = [
    'phone', 'phoneNumber', 'mobile', 'cell',
    /.*phone.*/i,
]

export const NAME_FIELDS: FieldPattern[] = [
    'firstName', 'lastName', 'fullName', 'username', 'userId',
]

export const FINANCIAL_FIELDS: FieldPattern[] = [
    'ssn', 'socialSecurity',
    'creditCard', 'cardNumber', 'accountNumber',
]

export const ADDRESS_FIELDS: FieldPattern[] = [
    'address', 'street', 'city', 'zipCode', 'postalCode',
]

/** Ergonomic accessor for the field lists, used by the builder (`fields.passwords`). */
export const fields = {
    passwords: PASSWORD_FIELDS,
    emails: EMAIL_FIELDS,
    phones: PHONE_FIELDS,
    names: NAME_FIELDS,
    financial: FINANCIAL_FIELDS,
    addresses: ADDRESS_FIELDS,
} as const
