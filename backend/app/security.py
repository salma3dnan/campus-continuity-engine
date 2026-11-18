import os
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .models import User

hasher = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)

def create_token(user: User) -> str:
    secret = os.environ.get("SECRET_KEY")
    if not secret or len(secret) < 32:
        raise RuntimeError("SECRET_KEY must be set to at least 32 characters")
    payload = {"sub": str(user.id), "exp": datetime.now(timezone.utc) + timedelta(hours=8)}
    return jwt.encode(payload, secret, algorithm="HS256")

def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db)
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin login required")
    try:
        payload = jwt.decode(credentials.credentials, os.environ["SECRET_KEY"], algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.get(User, user_id)
    if not user or user.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user
