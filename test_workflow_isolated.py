"""Isolated business-flow tests; no production DB access or external API calls."""
from test_smoke_isolated import client


def admin_headers():
    r = client.post('/api/auth/login', json={'username':'admin','password':'test-admin-password-unique-2026'})
    assert r.status_code == 200, r.text
    return {'Authorization':'Bearer '+r.json()['access_token']}


def test_vehicle_full_flow_and_revenue():
    h = admin_headers()
    area = client.post('/api/areas', json={'name':'Khu TEST','capacity':2}, headers=h)
    assert area.status_code == 200, area.text
    slots = client.get('/api/slots',headers=h).json()
    slot = next(s for s in slots if s['area_id'] == area.json()['id'])
    pricing = client.post('/api/pricing',json={'vehicle_type':'Xe máy','price_per_hour':10000},headers=h)
    assert pricing.status_code == 200, pricing.text
    start = client.post('/api/checkin',json={'license_plate':'20-B1 12345','vehicle_type':'Xe máy','slot_id':slot['id']},headers=h)
    assert start.status_code == 200, start.text
    record_id=start.json()['record_id']
    duplicate = client.post('/api/checkin',json={'license_plate':'20-B1 12345','vehicle_type':'Xe máy','slot_id':slot['id']},headers=h)
    assert duplicate.status_code == 409, duplicate.text
    preview = client.get(f'/api/checkout-preview/{record_id}',headers=h)
    assert preview.status_code == 200, preview.text
    checkout = client.post('/api/checkout',json={'record_id':record_id,'payment_method':'Tiền mặt'},headers=h)
    assert checkout.status_code == 200, checkout.text
    again = client.post('/api/checkout',json={'record_id':record_id},headers=h)
    assert again.status_code == 404, again.text
    assert all(x['id'] != record_id for x in client.get('/api/active',headers=h).json())
    receipt = client.get(f'/api/receipt/{record_id}',headers=h)
    assert receipt.status_code == 200
    assert client.get('/api/revenue',headers=h).status_code == 200


def test_monthly_pass_waives_fee():
    h = admin_headers()
    r = client.post('/api/monthly',json={'license_plate':'30-A1 56789','vehicle_type':'Xe máy','customer_name':'Khach thu nghiem','months':1,'price':120000},headers=h)
    assert r.status_code == 200, r.text
    checkin = client.post('/api/checkin',json={'license_plate':'30-A1 56789','vehicle_type':'Xe máy'},headers=h)
    assert checkin.status_code == 200, checkin.text
    rid = checkin.json()['record_id']
    preview = client.get(f'/api/checkout-preview/{rid}',headers=h)
    assert preview.status_code == 200 and preview.json()['monthly_pass'] is True, preview.text
    checkout = client.post('/api/checkout',json={'record_id':rid},headers=h)
    assert checkout.status_code == 200 and checkout.json()['fee'] == 0, checkout.text
    assert client.delete(f"/api/monthly/{r.json()['id']}",headers=h).status_code == 200


def test_staff_role_restrictions():
    h = admin_headers()
    created = client.post('/api/users',json={'username':'staff_test_unique','password':'test-guest-password-123','role':'staff','full_name':'Staff Test'},headers=h)
    assert created.status_code == 200, created.text
    login = client.post('/api/auth/login',json={'username':'staff_test_unique','password':'test-guest-password-123'})
    assert login.status_code == 200, login.text
    sh={'Authorization':'Bearer '+login.json()['access_token']}
    # Staff may check vehicles in; area management remains manager-only
    assert client.post('/api/areas',json={'name':'Forbidden','capacity':1},headers=sh).status_code == 403
    assert client.get('/api/revenue',headers=sh).status_code == 200  # staff has read access


def test_staff_cannot_waive_parking_fee():
    h = admin_headers()
    client.post('/api/pricing', json={'vehicle_type':'Xe máy','price_per_hour':10000}, headers=h)
    staff_name = 'staff_no_free_checkout'
    created = client.post('/api/users', json={'username':staff_name,'password':'test-staff-secret-123','role':'staff','full_name':'Staff'}, headers=h)
    assert created.status_code == 200, created.text
    login = client.post('/api/auth/login', json={'username':staff_name,'password':'test-staff-secret-123'})
    assert login.status_code == 200
    sh = {'Authorization':'Bearer '+login.json()['access_token']}
    start = client.post('/api/checkin', json={'license_plate':'29-X1 67890','vehicle_type':'Xe máy'}, headers=h)
    assert start.status_code == 200, start.text
    rid = start.json()['record_id']
    waived = client.post('/api/checkout', json={'record_id':rid,'payment_method':'Miễn phí'}, headers=sh)
    assert waived.status_code == 403, waived.text
    assert any(row['id'] == rid for row in client.get('/api/active', headers=h).json())
    normal = client.post('/api/checkout', json={'record_id':rid,'payment_method':'Tiền mặt'}, headers=sh)
    assert normal.status_code == 200, normal.text
