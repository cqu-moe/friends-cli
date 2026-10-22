export const FriendsErrorCode = {
  InvalidInput: "INVALID_INPUT",
  AuthRequired: "AUTH_REQUIRED",
  PermissionDenied: "PERMISSION_DENIED",
  UpstreamBusiness: "BUSINESS_REJECTED",
  NetworkProtocol: "NETWORK_PROTOCOL_ERROR",
  UnknownOutcome: "UNKNOWN_OUTCOME",
} as const;

export type FriendsErrorCode = (typeof FriendsErrorCode)[keyof typeof FriendsErrorCode];

export interface WriteRecovery {
  operation: string;
  activityId?: string;
  registrationId?: string;
  applicationId?: string;
  organizationId?: string;
  draftId?: string;
  completed?: string[];
  serverAcknowledged?: boolean | "unknown";
  readback?: "matched" | "unmatched" | "unavailable";
}

export class FriendsError extends Error {
  readonly code: FriendsErrorCode;
  readonly retryable: boolean;
  readonly upstreamCode?: string;
  readonly requestId?: string;
  readonly recovery?: WriteRecovery;

  constructor(options: {
    code: FriendsErrorCode;
    message: string;
    retryable?: boolean;
    upstreamCode?: string;
    requestId?: string;
    recovery?: WriteRecovery;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "FriendsError";
    this.code = options.code;
    this.retryable = options.code === FriendsErrorCode.UnknownOutcome ? false : options.retryable ?? false;
    this.upstreamCode = options.upstreamCode;
    this.requestId = options.requestId;
    this.recovery = options.recovery ? structuredClone(options.recovery) : undefined;
  }
}

export function exitCodeFor(error: FriendsErrorCode): number {
  if (error === FriendsErrorCode.InvalidInput) return 2;
  if (error === FriendsErrorCode.AuthRequired) return 3;
  if (error === FriendsErrorCode.PermissionDenied) return 4;
  if (error === FriendsErrorCode.UpstreamBusiness) return 5;
  if (error === FriendsErrorCode.UnknownOutcome) return 7;
  return 6;
}
