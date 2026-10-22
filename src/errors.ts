export const FriendsErrorCode = {
  InvalidInput: "INVALID_INPUT",
  AuthRequired: "AUTH_REQUIRED",
  PermissionDenied: "PERMISSION_DENIED",
  UpstreamBusiness: "BUSINESS_REJECTED",
  NetworkProtocol: "NETWORK_PROTOCOL_ERROR",
} as const;

export type FriendsErrorCode = (typeof FriendsErrorCode)[keyof typeof FriendsErrorCode];

export class FriendsError extends Error {
  readonly code: FriendsErrorCode;
  readonly retryable: boolean;
  readonly upstreamCode?: string;
  readonly requestId?: string;

  constructor(options: {
    code: FriendsErrorCode;
    message: string;
    retryable?: boolean;
    upstreamCode?: string;
    requestId?: string;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "FriendsError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.upstreamCode = options.upstreamCode;
    this.requestId = options.requestId;
  }
}

export function exitCodeFor(error: FriendsErrorCode): number {
  if (error === FriendsErrorCode.InvalidInput) return 2;
  if (error === FriendsErrorCode.AuthRequired) return 3;
  if (error === FriendsErrorCode.PermissionDenied) return 4;
  if (error === FriendsErrorCode.UpstreamBusiness) return 5;
  return 6;
}
