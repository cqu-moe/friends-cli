import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FriendsError, FriendsErrorCode, exitCodeFor} from '../dist/index.js';

test('uncertain writes expose a non-retryable exit-7 error with recovery evidence', () => {
  const error = new FriendsError({
    code: FriendsErrorCode.UnknownOutcome,
    retryable: true,
    message: 'Submission may have been accepted; query its status before another attempt',
    recovery: {operation:'volunteer.certification.submit', activityId:'activity-demo', completed:['attachment:demo']},
  });
  assert.equal(error.code, 'UNKNOWN_OUTCOME');
  assert.equal(exitCodeFor(error.code), 7);
  assert.equal(error.retryable, false);
  assert.deepEqual(error.recovery, {operation:'volunteer.certification.submit',activityId:'activity-demo',completed:['attachment:demo']});
});
