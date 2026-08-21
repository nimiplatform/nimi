/**
 * Centralized default English copy for the commerce UI surfaces. Hosts still
 * override every label per prop; this module only collects the destructured
 * defaults into one reviewable place without changing any prop interface.
 */
export const DEFAULT_COMMERCE_COPY = Object.freeze({
  sendGiftDialog: Object.freeze({
    title: 'Send Gift',
    closeLabel: 'Close',
    selectGiftLabel: 'Select Gift',
    sparkCostLabel: 'Spark Cost',
    sparkUnitLabel: 'SPARK',
    loadingCatalogLabel: 'Loading gifts...',
    loadCatalogFailedLabel: 'Failed to load gifts.',
    retryLoadCatalogLabel: 'Retry',
    emptyCatalogLabel: 'No gifts available',
    emptyCatalogDescription: 'Gift catalog is currently unavailable.',
    messageLabel: 'Message (Optional)',
    messagePlaceholder: 'Add a nice message...',
    recipientOnlyLabel: 'Only recipient can see',
    sendGiftLabel: 'Send Gift',
    sendingLabel: 'Sending...',
  }),
  giftInboxList: Object.freeze({
    unknownGiftLabel: 'Gift',
    loadingLabel: 'Loading received gifts...',
    emptyLabel: 'No received gifts yet',
    refreshLabel: 'Refresh',
  }),
  giftInboxDetail: Object.freeze({
    unknownGiftLabel: 'Gift',
    transactionLabel: 'Transaction',
    senderLabel: 'Sender',
    receiverLabel: 'Receiver',
    senderMessageLabel: 'Sender message',
    rejectReasonLabel: 'Reject reason',
    expiresAtLabel: 'Expires',
    acceptedAtLabel: 'Accepted',
    rejectedAtLabel: 'Rejected',
    pendingTitle: 'Respond to this gift',
    pendingDescription: 'Accepting credits Gem to your internal wallet. Withdrawal stays in Wallet.',
    rejectReasonOptionalLabel: 'Reject reason (optional)',
    rejectReasonPlaceholder: 'Tell the sender why you rejected this gift',
    acceptLabel: 'Accept',
    acceptingLabel: 'Accepting...',
    rejectLabel: 'Reject',
    rejectingLabel: 'Rejecting...',
    withdrawTitle: 'Accepted gifts are now in your wallet',
    withdrawDescription: 'Use Wallet to review your Gem balance and withdraw when eligible.',
    openWalletLabel: 'Open Wallet',
    senderReadonlyLabel: 'You are viewing this gift as the sender. Status changes happen on the receiver side.',
  }),
});
