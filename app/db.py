import typing
import psycopg
from pydantic import BaseModel


class InventoryItem(BaseModel):
    id: int
    name: str
    category: str
    unit: str
    quantity_in_stock: int
    quantity_reserved: int
    quantity_available: int
    low_stock_threshold: int


class Request(BaseModel):
    id: int
    item_id: int
    amount: int
    notes: str
    room: str
    request_status: str
    eta_minutes: int | None
    created_at: str
    updated_at: str


class SvaraDB:
    def __init__(
        self,
        db_name: str,
        db_user: str,
        db_password: str,
        remote_addr: str = "localhost",
    ) -> None:
        self.db_name = db_name
        self.db_user = db_user
        self.db_password = db_password
        self.remote_addr = remote_addr

    """
    Create and return an async database connection using psycopg 3.
    """
    async def get_connection(self):
        try:
            return await psycopg.AsyncConnection.connect(
                f"host={self.remote_addr} dbname={self.db_name} user={self.db_user} password={self.db_password} connect_timeout=10"
            )
        except Exception as e:
            print(f"DATABASE CONNECTION ERROR: {e}")
            raise

    async def get_items(self) -> list[InventoryItem]:
        async with await self.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT * FROM inventory_items")
                rows = await cursor.fetchall()
                return [
                    InventoryItem(
                        id=r[0],
                        name=r[1],
                        category=r[2],
                        unit=r[3],
                        quantity_in_stock=r[4],
                        quantity_reserved=r[5],
                        quantity_available=r[6],
                        low_stock_threshold=r[7],
                    )
                    for r in rows
                ]

    async def add_request(
        self, room: str, item_id: int, item_amount: int, text: str
    ) -> int | None:
        """
        Atomically reserve stock and create a new request.
        Returns the request ID if successful, or None if insufficient stock.
        """
        async with await self.get_connection() as conn:
            async with conn.cursor() as cursor:
                # Transaction ensures atomicity
                await cursor.execute(
                    "SELECT quantity_available FROM inventory_items WHERE id = %s FOR UPDATE",
                    (item_id,),
                )
                res = await cursor.fetchone()

                if not res or res[0] < item_amount:
                    return None  # Insufficient stock

                # Reserve stock
                await cursor.execute(
                    """
                                     UPDATE inventory_items
                                     SET quantity_reserved  = quantity_reserved + %s,
                                         quantity_available = quantity_available - %s
                                     WHERE id = %s
                                     """,
                    (item_amount, item_amount, item_id),
                )

                # Insert new request
                await cursor.execute(
                    """
                    INSERT INTO requests (room, item_id, amount, notes, request_status, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, 'sent', NOW(), NOW())
                    RETURNING id;
                    """,
                    (room, item_id, item_amount, text),
                )

                row = await cursor.fetchone()
                if not row:
                    return None
                req_id = row[0]
                await conn.commit()
                return req_id

    async def update_request(
        self, id: int, request_status: str | None = None, eta_minutes: int | None = None
    ) -> None:
        """
        Update a request's status and ETA.
        Deducts stock if delivered, or releases reserved stock if rejected/cancelled.
        """
        async with await self.get_connection() as conn:
            async with conn.cursor() as cursor:
                # Fetch current request
                await cursor.execute(
                    "SELECT item_id, amount, request_status FROM requests WHERE id = %s FOR UPDATE",
                    (id,),
                )
                req = await cursor.fetchone()
                if not req:
                    raise ValueError("Request not found")

                item_id, amount, current_status = req

                # Deduct stock if delivered
                if request_status == "DELIVERED" and current_status != "DELIVERED":
                    await cursor.execute(
                        """
                                         UPDATE inventory_items
                                         SET quantity_in_stock = quantity_in_stock - %s,
                                             quantity_reserved = quantity_reserved - %s
                                         WHERE id = %s
                                         """,
                        (amount, amount, item_id),
                    )

                # Release reserved stock if rejected/cancelled
                elif request_status == "REJECTED" and current_status not in (
                    "REJECTED",
                    "DELIVERED",
                ):
                    await cursor.execute(
                        """
                                         UPDATE inventory_items
                                         SET quantity_reserved  = quantity_reserved - %s,
                                             quantity_available = quantity_available + %s
                                         WHERE id = %s
                                         """,
                        (amount, amount, item_id),
                    )

                # Update request row
                if request_status and eta_minutes:
                    await cursor.execute(
                        "UPDATE requests SET request_status=%s, eta_minutes=%s, updated_at=NOW() WHERE id=%s",
                        (request_status, eta_minutes, id),
                    )
                elif request_status:
                    await cursor.execute(
                        "UPDATE requests SET request_status=%s, updated_at=NOW() WHERE id=%s",
                        (request_status, id),
                    )
                elif eta_minutes:
                    await cursor.execute(
                        "UPDATE requests SET eta_minutes=%s, updated_at=NOW() WHERE id=%s",
                        (eta_minutes, id),
                    )

                await conn.commit()

    async def get_requests(self) -> list[Request]:
        async with await self.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT * FROM requests ORDER BY created_at DESC")
                requests = await cursor.fetchall()
        return [
            Request(
                id=x[0],
                room=x[1],
                item_id=x[2],
                amount=x[3],
                request_status=x[4],
                notes=x[5],
                eta_minutes=x[6],
                created_at=str(x[7]),
                updated_at=str(x[8]),
            )
            for x in requests
        ]

    async def get_room_request(self, room: int | str) -> list[Request]:
        async with await self.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "SELECT * FROM requests WHERE room = %s ORDER BY created_at DESC",
                    (room,),
                )
                requests = await cursor.fetchall()
        return [
            Request(
                id=x[0],
                room=x[1],
                item_id=x[2],
                amount=x[3],
                request_status=x[4],
                notes=x[5],
                eta_minutes=x[6],
                created_at=str(x[7]),
                updated_at=str(x[8]),
            )
            for x in requests
        ]

    async def restock_item(self, item_id: int, amount: int = 5) -> None:
        """
        Add stock to an item and update its availability.
        """
        async with await self.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE inventory_items
                    SET quantity_in_stock = quantity_in_stock + %s,
                        quantity_available = quantity_available + %s
                    WHERE id = %s
                    """,
                    (amount, amount, item_id),
                )
                await conn.commit()
