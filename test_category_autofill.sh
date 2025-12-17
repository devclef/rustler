#!/bin/bash

# Test script for category auto-fill API endpoint
# This script tests the GET /api/payees/:name/last-category endpoint

echo "Testing category auto-fill API endpoint..."

# Test 1: Test with a non-existent payee (should return empty response)
echo "Test 1: Non-existent payee"
response=$(curl -s -w "%{http_code}" http://localhost:3000/api/payees/NonExistentPayee/last-category)
http_code="${response: -3}"
body="${response%???}"

if [ "$http_code" = "200" ]; then
    echo "✓ HTTP 200 OK"
    echo "Response: $body"
    # Should return {"category_id":null,"category_name":null}
    if [[ "$body" == *'"category_id":null'* ]] && [[ "$body" == *'"category_name":null'* ]]; then
        echo "✓ Correct response format for non-existent payee"
    else
        echo "✗ Unexpected response format"
    fi
else
    echo "✗ HTTP $http_code (expected 200)"
    echo "Response: $body"
fi

echo ""

# Test 2: Test with URL encoding for payee names with spaces
echo "Test 2: Payee name with spaces (URL encoded)"
response=$(curl -s -w "%{http_code}" http://localhost:3000/api/payees/Test%20Payee/last-category)
http_code="${response: -3}"
body="${response%???}"

if [ "$http_code" = "200" ]; then
    echo "✓ HTTP 200 OK"
    echo "Response: $body"
else
    echo "✗ HTTP $http_code (expected 200)"
    echo "Response: $body"
fi

echo ""

# Test 3: Test with special characters
echo "Test 3: Payee name with special characters"
response=$(curl -s -w "%{http_code}" http://localhost:3000/api/payees/Caf%C3%A9%20Restaurant/last-category)
http_code="${response: -3}"
body="${response%???}"

if [ "$http_code" = "200" ]; then
    echo "✓ HTTP 200 OK"
    echo "Response: $body"
else
    echo "✗ HTTP $http_code (expected 200)"
    echo "Response: $body"
fi

echo ""
echo "Category auto-fill API endpoint tests completed."