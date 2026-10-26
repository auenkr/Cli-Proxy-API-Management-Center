/** Mask email-like fragments (a•••@d•••.com) so screenshots do not leak accounts. */
const EMAIL_PATTERN =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9])[A-Za-z0-9-]*(\.[A-Za-z0-9.-]+)?/g;

export const maskEmails = (value: string): string =>
  value.replace(EMAIL_PATTERN, (_match, local: string, domain: string, rest = '') => {
    return `${local}•••@${domain}•••${rest.includes('.') ? rest.slice(rest.lastIndexOf('.')) : ''}`;
  });
