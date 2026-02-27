import urllib.request
import json
import traceback

data = json.dumps({"email": "test@test.com", "password": "test123"}).encode("utf-8")
req = urllib.request.Request("http://localhost:5173/api/auth/login", data=data)
req.add_header('Content-Type', 'application/json')

try:
    response = urllib.request.urlopen(req)
    print("Success:", response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(f"HTTPError: {e.code}")
    print(e.read().decode('utf-8'))
except Exception as e:
    print("Other error:", e)
    traceback.print_exc()
