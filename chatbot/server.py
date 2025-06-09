from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import pickle
import random
import os

app = Flask(__name__)
CORS(app)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(BASE_DIR, 'model.pkl'), 'rb') as f:
    model = pickle.load(f)

with open(os.path.join(BASE_DIR, 'vectorizer.pkl'), 'rb') as f:
    vectorizer = pickle.load(f)

with open(os.path.join(BASE_DIR, 'intent.json'), 'r') as f:
    intents = json.load(f)

def get_response(user_input):
    X_vect = vectorizer.transform([user_input])
    predicted_tag = model.predict(X_vect)[0]
    for intent in intents['intents']:
        if intent['tag'] == predicted_tag:
            return random.choice(intent['responses'])
    return "Sorry, I don't understand."

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_input = data.get('message', '')
    response = get_response(user_input)
    return jsonify({'response': response})

if __name__ == '__main__':
    app.run(port=5000)
