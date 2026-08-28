"""
Configuration for the Verification Worker.

Uses pydantic-settings for type-safe environment variable loading.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Supabase
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # AI/OCR
    ocr_language: str = "eng"  # Tesseract language
    max_image_size_mb: int = 20
    confidence_threshold: float = 0.7

    # Queue
    poll_interval_seconds: int = 5
    max_retries: int = 3
    batch_size: int = 10

    # Model freeze (set before election day)
    ocr_model_version: str = "tesseract-5.3.0"
    verification_rules_version: str = "v1.0"

    model_config = {
        "env_prefix": "AI_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


settings = Settings()
