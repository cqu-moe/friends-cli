import {FriendsError,FriendsErrorCode} from './errors.js';
export const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
export const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==='string');
export const executionFailure=(value:unknown):boolean=>value===null||record(value)&&typeof value.code==='string'&&typeof value.message==='string';
export const pageActions=(value:unknown,allowed:readonly string[]):boolean=>Array.isArray(value)&&value.every(item=>record(item)&&typeof item.field==='string'&&typeof item.action==='string'&&allowed.includes(item.action));
export function knownPrecondition(cause:unknown):cause is FriendsError {
 return cause instanceof FriendsError&&[FriendsErrorCode.AuthRequired,FriendsErrorCode.PermissionDenied,FriendsErrorCode.InvalidInput,FriendsErrorCode.UpstreamBusiness].some(code=>code===cause.code);
}
