import os
from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
from werkzeug.exceptions import HTTPException
from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from geopy.geocoders import Nominatim

# --- App & CORS setup ---
app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

# JSON‐ify all HTTP errors
@app.errorhandler(HTTPException)
def handle_http_exception(e):
    return jsonify(error=e.description), e.code

# Fallback for uncaught exceptions
@app.errorhandler(Exception)
def handle_generic_exception(e):
    return jsonify(error=str(e)), 500

# --- Database setup ---
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///addresses.db')
engine = create_engine(DATABASE_URL, echo=True, future=True)
Session = sessionmaker(bind=engine, future=True)
Base = declarative_base()

class Address(Base):
    __tablename__ = 'addresses'
    id             = Column(Integer, primary_key=True)
    text           = Column(String,  nullable=False)
    lat            = Column(Float,   nullable=False)
    lng            = Column(Float,   nullable=False)
    status         = Column(String,  nullable=False)
    follow_up_date = Column(String,  nullable=True)
    notes          = Column(String,  nullable=True)

Base.metadata.create_all(engine)

geolocator = Nominatim(user_agent="gta_map_app")

# --- Routes ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/addresses', methods=['GET'])
def get_addresses():
    with Session() as session:
        addrs = session.query(Address).all()
        return jsonify([{
            'id': a.id,
            'text': a.text,
            'lat': a.lat,
            'lng': a.lng,
            'status': a.status,
            'follow_up_date': a.follow_up_date or '',
            'notes': a.notes or ''
        } for a in addrs])

@app.route('/api/addresses', methods=['POST'])
def add_address():
    data = request.get_json() or {}
    text   = (data.get('text') or '').strip()
    status = data.get('status', 'Not contacted')
    if not text:
        return jsonify(error="Address required"), 400

    # If front-end provided coords, use them:
    lat = data.get('lat')
    lng = data.get('lng')
    if lat is not None and lng is not None:
        try:
            location_lat = float(lat)
            location_lng = float(lng)
        except ValueError:
            return jsonify(error="Invalid coordinates"), 400
    else:
        # Otherwise geocode the text
        loc = geolocator.geocode(text)
        if not loc:
            return jsonify(error="Geocoding failed"), 400
        location_lat = loc.latitude
        location_lng = loc.longitude

    with Session() as session:
        a = Address(
            text=text,
            lat=location_lat,
            lng=location_lng,
            status=status,
            follow_up_date=data.get('follow_up_date',''),
            notes=data.get('notes','')
        )
        session.add(a)
        session.commit()
        return jsonify({
            'id': a.id,
            'text': a.text,
            'lat': a.lat,
            'lng': a.lng,
            'status': a.status,
            'follow_up_date': a.follow_up_date or '',
            'notes': a.notes or ''
        }), 201

@app.route('/api/addresses/<int:addr_id>', methods=['PUT'])
def update_address(addr_id):
    data = request.get_json() or {}
    with Session() as session:
        a = session.get(Address, addr_id)
        if not a:
            return jsonify(error="Address not found"), 404
        for field in ('status','follow_up_date','notes'):
            if field in data:
                setattr(a, field, data[field])
        session.commit()
        return jsonify({
            'id': a.id,
            'text': a.text,
            'lat': a.lat,
            'lng': a.lng,
            'status': a.status,
            'follow_up_date': a.follow_up_date or '',
            'notes': a.notes or ''
        }), 200

@app.route('/api/addresses/<int:addr_id>', methods=['DELETE'])
def delete_address(addr_id):
    with Session() as session:
        a = session.get(Address, addr_id)
        if not a:
            return jsonify(error="Address not found"), 404
        session.delete(a)
        session.commit()
        return jsonify(id=addr_id), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
