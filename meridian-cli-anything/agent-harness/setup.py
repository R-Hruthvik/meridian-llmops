from setuptools import find_namespace_packages, setup

setup(
    name="cli-anything-meridian",
    version="1.0.0",
    description="CLI harness for Meridian RAG backend",
    packages=find_namespace_packages(include=["cli_anything.*"]),
    python_requires=">=3.11",
    install_requires=[
        "click>=8.0",
        "httpx>=0.27.0",
    ],
    extras_require={
        "repl": ["prompt_toolkit>=3.0.0"],
    },
    entry_points={
        "console_scripts": [
            "cli-anything-meridian=cli_anything.meridian.meridian_cli:main",
        ],
    },
    package_data={
        "cli_anything.meridian": ["skills/*.md"],
    },
)
