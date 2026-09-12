from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="DOCKET_", extra="ignore")

    firecrawl_api_key: SecretStr | None = None

    database_url: str = "sqlite:///./docket.db"

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
