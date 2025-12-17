#!/bin/bash

# Test script for the cleared status API endpoint
# This script tests the PATCH /api/transactions/{id}/cleared-status endpoint

set -e

BASE_URL="http://localhost:3000"

echo "=== Testing Cleared Status API Endpoint ==="

# 1. Create a test account
echo "Creating test account..."
ACCOUNT_ID=$(curl -s -X POST "$BASE_URL/api/accounts" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Account for Cleared Status","account_type":"On Budget","balance":1000,"currency":"USD"}' \
  | jq -r '.id')

echo "Created account with ID: $ACCOUNT_ID"

# 2. Create a test transaction
echo "Creating test transaction..."
TRANSACTION_ID=$(curl -s -X POST "$BASE_URL/api/transactions" \
  -H "Content-Type: application/json" \
  -d "{\"source_account_id\":\"$ACCOUNT_ID\",\"description\":\"Test Transaction for Cleared Status\",\"amount\":100,\"category\":\"Test Category\"}" \
  | jq -r '.id')

echo "Created transaction with ID: $TRANSACTION_ID"

# 3. Get the transaction to verify initial cleared status (should be uncleared)
echo "Getting initial transaction state..."
INITIAL_TRANSACTION=$(curl -s -X GET "$BASE_URL/api/transactions/$TRANSACTION_ID")
echo "Initial transaction: $INITIAL_TRANSACTION" | jq .
INITIAL_STATUS=$(echo "$INITIAL_TRANSACTION" | jq -r '.cleared_status')
echo "Initial cleared status: $INITIAL_STATUS"

# 4. Update cleared status to 'cleared'
echo "Updating cleared status to 'cleared'..."
CLEARED_TRANSACTION=$(curl -s -X PATCH "$BASE_URL/api/transactions/$TRANSACTION_ID/cleared-status" \
  -H "Content-Type: application/json" \
  -d '{"status":"cleared"}')
echo "Updated transaction: $CLEARED_TRANSACTION" | jq .
CLEARED_STATUS=$(echo "$CLEARED_TRANSACTION" | jq -r '.cleared_status')
echo "New cleared status: $CLEARED_STATUS"

# 5. Update cleared status to 'reconciled'
echo "Updating cleared status to 'reconciled'..."
RECONCILED_TRANSACTION=$(curl -s -X PATCH "$BASE_URL/api/transactions/$TRANSACTION_ID/cleared-status" \
  -H "Content-Type: application/json" \
  -d '{"status":"reconciled"}')
echo "Updated transaction: $RECONCILED_TRANSACTION" | jq .
RECONCILED_STATUS=$(echo "$RECONCILED_TRANSACTION" | jq -r '.cleared_status')
echo "New cleared status: $RECONCILED_STATUS"

# 6. Update cleared status back to 'uncleared'
echo "Updating cleared status back to 'uncleared'..."
UNCLEARED_TRANSACTION=$(curl -s -X PATCH "$BASE_URL/api/transactions/$TRANSACTION_ID/cleared-status" \
  -H "Content-Type: application/json" \
  -d '{"status":"uncleared"}')
echo "Updated transaction: $UNCLEARED_TRANSACTION" | jq .
FINAL_STATUS=$(echo "$UNCLEARED_TRANSACTION" | jq -r '.cleared_status')
echo "Final cleared status: $FINAL_STATUS"

# 7. Test error case - invalid transaction ID
echo "Testing error case with invalid transaction ID..."
ERROR_RESPONSE=$(curl -s -w "%{http_code}" -X PATCH "$BASE_URL/api/transactions/00000000-0000-0000-0000-000000000000/cleared-status" \
  -H "Content-Type: application/json" \
  -d '{"status":"cleared"}')
echo "Error response: $ERROR_RESPONSE"

# 8. Get account to check cleared balance changes
echo "Getting account to check cleared balance..."
ACCOUNT_DETAILS=$(curl -s -X GET "$BASE_URL/api/accounts/$ACCOUNT_ID")
echo "Account details: $ACCOUNT_DETAILS" | jq .

# 9. Clean up - delete the transaction
echo "Cleaning up - deleting transaction..."
curl -s -X DELETE "$BASE_URL/api/transactions/$TRANSACTION_ID"

# 10. Clean up - delete the account
echo "Cleaning up - deleting account..."
curl -s -X DELETE "$BASE_URL/api/accounts/$ACCOUNT_ID"

echo "Test completed successfully!"

# Verify the status transitions worked correctly
if [[ "$INITIAL_STATUS" == "uncleared" && "$CLEARED_STATUS" == "cleared" && "$RECONCILED_STATUS" == "reconciled" && "$FINAL_STATUS" == "uncleared" ]]; then
  echo "✓ All cleared status transitions worked correctly"
else
  echo "✗ Some cleared status transitions failed"
  echo "  Initial: $INITIAL_STATUS (expected: uncleared)"
  echo "  Cleared: $CLEARED_STATUS (expected: cleared)"
  echo "  Reconciled: $RECONCILED_STATUS (expected: reconciled)"
  echo "  Final: $FINAL_STATUS (expected: uncleared)"
fi