# First Steps
> 原文链接: https://fastapi.tiangolo.com/tutorial/first-steps/

---

# First Steps[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#first-steps "Permanent link")

The simplest FastAPI file could look like this:

[Python 3.10+](#__tabbed_1_1)

`from fastapi import FastAPI app = FastAPI() @app.get("/") async def root():     return {"message": "Hello World"}`

Copy that to a file `main.py`.

Tip

FastAPI has an [official extension for VS Code](https://marketplace.visualstudio.com/items?itemName=FastAPILabs.fastapi-vscode) (and Cursor), which provides a lot of features, including a path operation explorer, path operation search, CodeLens navigation in tests (jump to definition from tests), and FastAPI Cloud deployment and logs, all from your editor.

Run the live server:

`<font color="#4E9A06">uv run fastapi</font> dev`

fast →uv run fastapi dev   FastAPI   Starting development server 🚀
             Searching for package file structure from directories
             with \_\_init\_\_.py files
             Importing from /home/user/code/awesomeapp
    module   🐍 main.py
      code   Importing the FastAPI app object from the module with
             the following code:
             from **main** import **app**
       app   Using import string: main:app
    server   Server started at http://127.0.0.1:8000
    server   Documentation at http://127.0.0.1:8000/docs
       tip   Running in development mode, for production use:
             **fastapi run**
             Logs:
      INFO   Will watch for changes in these directories:
             **\[**'/home/user/code/awesomeapp'**\]**
      INFO   Uvicorn running on http://127.0.0.1:8000 **(**Press CTRL+C
             to quit**)**
      INFO   Started reloader process **\[****383138****\]** using WatchFiles
      INFO   Started server process **\[****383153****\]**
      INFO   Waiting for application startup.
      INFO   Application startup complete.restart ↻

In the output, there's a line with something like:

`INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)`

That line shows the URL where your app is being served on your local machine.

### Check it[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#check-it "Permanent link")

Open your browser at [http://127.0.0.1:8000](http://127.0.0.1:8000/).

You will see the JSON response as:

`{"message": "Hello World"}`

### Interactive API docs[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#interactive-api-docs "Permanent link")

Now go to [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

You will see the automatic interactive API documentation (provided by [Swagger UI](https://github.com/swagger-api/swagger-ui)):

![Swagger UI](images/img_001.png)

### Alternative API docs[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#alternative-api-docs "Permanent link")

And now, go to [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc).

You will see the alternative automatic documentation (provided by [ReDoc](https://github.com/Redocly/redoc)):

![ReDoc](images/img_002.png)

### OpenAPI[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#openapi "Permanent link")

**FastAPI** generates a "schema" with all your API using the **OpenAPI** standard for defining APIs.

#### "Schema"[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#schema "Permanent link")

A "schema" is a definition or description of something. Not the code that implements it, but just an abstract description.

#### API "schema"[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#api-schema "Permanent link")

In this case, [OpenAPI](https://github.com/OAI/OpenAPI-Specification) is a specification that dictates how to define a schema of your API.

This schema definition includes your API paths, the possible parameters they take, etc.

#### Data "schema"[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#data-schema "Permanent link")

The term "schema" might also refer to the shape of some data, like a JSON content.

In that case, it would mean the JSON attributes, and data types they have, etc.

#### OpenAPI and JSON Schema[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#openapi-and-json-schema "Permanent link")

OpenAPI defines an API schema for your API. And that schema includes definitions (or "schemas") of the data sent and received by your API using **JSON Schema**, the standard for JSON data schemas.

#### Check the `openapi.json`[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#check-the-openapi-json "Permanent link")

If you are curious about what the raw OpenAPI schema looks like, FastAPI automatically generates a JSON (schema) with the descriptions of all your API.

You can see it directly at: [http://127.0.0.1:8000/openapi.json](http://127.0.0.1:8000/openapi.json).

It will show a JSON starting with something like:

`{     "openapi": "3.1.0",    "info": {        "title": "FastAPI",        "version": "0.1.0"    },    "paths": {        "/items/": {            "get": {                "responses": {                    "200": {                        "description": "Successful Response",                        "content": {                            "application/json": { ...`

#### What is OpenAPI for[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#what-is-openapi-for "Permanent link")

The OpenAPI schema is what powers the two interactive documentation systems included.

And there are dozens of alternatives, all based on OpenAPI. You could easily add any of those alternatives to your application built with **FastAPI**.

You could also use it to generate code automatically, for clients that communicate with your API. For example, frontend, mobile or IoT applications.

### Configure the app `entrypoint` in `pyproject.toml`[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#configure-the-app-entrypoint-in-pyproject-toml "Permanent link")

You can configure where your app is located in a `pyproject.toml` file like:

`[tool.fastapi] entrypoint = "main:app"`

That `entrypoint` will tell the `fastapi` command that it should import the app like:

`from main import app`

If your code was structured like:

`. ├── backend │   ├── main.py │   ├── __init__.py`

Then you would set the `entrypoint` as:

`[tool.fastapi] entrypoint = "backend.main:app"`

which would be equivalent to:

`from backend.main import app`

### `fastapi dev` with path or with `--entrypoint` CLI option[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#fastapi-dev-with-path-or-with-entrypoint-cli-option "Permanent link")

You can also pass the file path to the `fastapi dev` command, and it will guess the FastAPI app object to use:

`$ uv run fastapi dev main.py`

Or, you can also pass the `--entrypoint` option to the `fastapi dev` command:

`$ uv run fastapi dev --entrypoint main:app`

But you would have to remember to pass the correct path\\entrypoint every time you call the `fastapi` command.

Additionally, other tools might not be able to find it, for example the [VS Code Extension](https://fastapi.tiangolo.com/editor-support/) or [FastAPI Cloud](https://fastapicloud.com/), so it is recommended to use the `entrypoint` in `pyproject.toml`.

### Deploy your app (optional)[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#deploy-your-app-optional "Permanent link")

You can optionally deploy your FastAPI app to [FastAPI Cloud](https://fastapicloud.com/) with a single command. 🚀

`uv run fastapi deploy`

fast →uv run fastapi deploy
Deploying to FastAPI Cloud...
✅ Deployment successful!
🐔 Ready the chicken! Your app is ready at https://myapp.fastapicloud.dev
restart ↻

The CLI will automatically detect your FastAPI application and deploy it to the cloud. If you are not logged in, your browser will open to complete the authentication process.

That's it! Now you can access your app at that URL. ✨

## Recap, step by step[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#recap-step-by-step "Permanent link")

### Step 1: import `FastAPI`[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#step-1-import-fastapi "Permanent link")

[Python 3.10+](#__tabbed_2_1)

`from fastapi import FastAPI app = FastAPI() @app.get("/") async def root():     return {"message": "Hello World"}`

`FastAPI` is a Python class that provides all the functionality for your API.

Technical Details

`FastAPI` is a class that inherits directly from `Starlette`.

You can use all the [Starlette](https://starlette.dev/) functionality with `FastAPI` too.

### Step 2: create a `FastAPI` "instance"[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#step-2-create-a-fastapi-instance "Permanent link")

[Python 3.10+](#__tabbed_3_1)

`from fastapi import FastAPI app = FastAPI() @app.get("/") async def root():     return {"message": "Hello World"}`

Here the `app` variable will be an "instance" of the class `FastAPI`.

This will be the main point of interaction to create all your API.

### Step 3: create a _path operation_[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#step-3-create-a-path-operation "Permanent link")

#### Path[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#path "Permanent link")

"Path" here refers to the last part of the URL starting from the first `/`.

So, in a URL like:

`https://example.com/items/foo`

...the path would be:

`/items/foo`

Note

A "path" is also commonly called an "endpoint" or a "route".

While building an API, the "path" is the main way to separate "concerns" and "resources".

#### Operation[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#operation "Permanent link")

"Operation" here refers to one of the HTTP "methods".

One of:

-   `POST`
-   `GET`
-   `PUT`
-   `DELETE`

...and the more exotic ones:

-   `OPTIONS`
-   `HEAD`
-   `PATCH`
-   `TRACE`

In the HTTP protocol, you can communicate to each path using one (or more) of these "methods".

* * *

When building APIs, you normally use these specific HTTP methods to perform a specific action.

Normally you use:

-   `POST`: to create data.
-   `GET`: to read data.
-   `PUT`: to update data.
-   `DELETE`: to delete data.

So, in OpenAPI, each of the HTTP methods is called an "operation".

We are going to call them "**operations**" too.

#### Define a _path operation decorator_[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#define-a-path-operation-decorator "Permanent link")

[Python 3.10+](#__tabbed_4_1)

`from fastapi import FastAPI app = FastAPI() @app.get("/") async def root():     return {"message": "Hello World"}`

The `@app.get("/")` tells **FastAPI** that the function right below is in charge of handling requests that go to:

-   the path `/`
-   using a `get` operation

`@decorator` Info

That `@something` syntax in Python is called a "decorator".

You put it on top of a function. Like a pretty decorative hat (I guess that's where the term came from).

A "decorator" takes the function below and does something with it.

In our case, this decorator tells **FastAPI** that the function below corresponds to the **path** `/` with an **operation** `get`.

It is the "**path operation decorator**".

You can also use the other operations:

-   `@app.post()`
-   `@app.put()`
-   `@app.delete()`

And the more exotic ones:

-   `@app.options()`
-   `@app.head()`
-   `@app.patch()`
-   `@app.trace()`

Tip

You are free to use each operation (HTTP method) as you wish.

**FastAPI** doesn't enforce any specific meaning.

The information here is presented as a guideline, not a requirement.

For example, when using GraphQL you normally perform all the actions using only `POST` operations.

### Step 4: define the **path operation function**[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#step-4-define-the-path-operation-function "Permanent link")

This is our "**path operation function**":

-   **path**: is `/`.
-   **operation**: is `get`.
-   **function**: is the function below the "decorator" (below `@app.get("/")`).

[Python 3.10+](#__tabbed_5_1)

`from fastapi import FastAPI app = FastAPI() @app.get("/") async def root():     return {"message": "Hello World"}`

This is a Python function.

It will be called by **FastAPI** whenever it receives a request to the URL "`/`" using a `GET` operation.

In this case, it is an `async` function.

* * *

You could also define it as a normal function instead of `async def`:

[Python 3.10+](#__tabbed_6_1)

`from fastapi import FastAPI app = FastAPI() @app.get("/") def root():     return {"message": "Hello World"}`

Note

If you don't know the difference, check the [Async: _"In a hurry?"_](https://fastapi.tiangolo.com/async/#in-a-hurry).

### Step 5: return the content[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#step-5-return-the-content "Permanent link")

[Python 3.10+](#__tabbed_7_1)

`from fastapi import FastAPI app = FastAPI() @app.get("/") async def root():     return {"message": "Hello World"}`

You can return a `dict`, `list`, singular values as `str`, `int`, etc.

You can also return Pydantic models (you'll see more about that later).

There are many other objects and models that will be automatically converted to JSON (including ORMs, etc). Try using your favorite ones, it's highly probable that they are already supported.

### Step 6: Deploy it[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#step-6-deploy-it "Permanent link")

Deploy your app to **[FastAPI Cloud](https://fastapicloud.com/)** with one command: `fastapi deploy`. 🎉

#### About FastAPI Cloud[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#about-fastapi-cloud "Permanent link")

**[FastAPI Cloud](https://fastapicloud.com/)** is built by the same author and team behind **FastAPI**.

It streamlines the process of **building**, **deploying**, and **accessing** an API with minimal effort.

It brings the same **developer experience** of building apps with FastAPI to **deploying** them to the cloud. 🎉

FastAPI Cloud is the primary sponsor and funding provider for the _FastAPI and friends_ open source projects. ✨

#### Deploy to other cloud providers[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#deploy-to-other-cloud-providers "Permanent link")

FastAPI is open source and based on standards. You can deploy FastAPI apps to any cloud provider you choose.

Follow your cloud provider's guides to deploy FastAPI apps with them. 🤓

## Recap[¶](https://fastapi.tiangolo.com/tutorial/first-steps/#recap "Permanent link")

-   Import `FastAPI`.
-   Create an `app` instance.
-   Write a **path operation decorator** using decorators like `@app.get("/")`.
-   Define a **path operation function**; for example, `def root(): ...`.
-   Run the development server using the command `fastapi dev`.
-   Optionally deploy your app with `fastapi deploy`.