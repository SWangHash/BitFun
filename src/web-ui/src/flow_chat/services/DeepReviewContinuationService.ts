import { flowChatManager } from './FlowChatManager';
import {
  buildDeepReviewContinuationPrompt,
  type DeepReviewInterruption,
} from '../utils/deepReviewContinuation';

export async function continueDeepReviewSession(
  interruption: DeepReviewInterruption,
  displayMessage: string,
): Promise<void> {
  if (!interruption.canResume) {
    throw new Error('deep_review_resume_blocked');
  }

  await flowChatManager.sendMessage(
    buildDeepReviewContinuationPrompt(interruption),
    interruption.childSessionId,
    displayMessage,
    'DeepReview',
    'agentic',
  );
}
