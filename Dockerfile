FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN useradd --uid 10001 --create-home calendar && mkdir /data && chown calendar:calendar /data
COPY --chown=calendar:calendar server.py /app/
COPY --chown=calendar:calendar public /app/public
USER calendar
EXPOSE 8765
CMD ["python", "server.py", "--host", "0.0.0.0", "--database", "/data/calendar.sqlite3"]
