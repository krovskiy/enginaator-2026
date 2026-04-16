import openai
import dotenv
from pathlib import Path
LMS_KEY = dotenv.dotenv_values(".env")["LMS_KEY"]
LMS_MODEL = dotenv.dotenv_values(".env")["LMS_MODEL"]
LMS_ENDPOINT = dotenv.dotenv_values(".env")["LMS_ENDPOINT"]

PROMPT = Path(dotenv.dotenv_values(".env")["PROMPT_PATH"]).read_text()

def prepare_prompt(prompt):
    return PROMPT.format()

def init_llm():
    client = openai.AsyncClient(api_key=LMS_KEY, base_url=LMS_ENDPOINT)
    return client


def get_response(client, prompt):
    response = client.chat.completions.create(
        model=LMS_MODEL,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content