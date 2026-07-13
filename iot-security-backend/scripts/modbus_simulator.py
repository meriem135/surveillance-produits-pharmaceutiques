#!/usr/bin/env python
"""
Simple Modbus TCP simulator for the IoT Security Backend.

Runs a Modbus server that simulates holding registers for:
- 0: Temperature (0.1°C units, e.g., 225 = 22.5°C)
- 1: Pressure (hPa)
- 2: Status (0=OK, 1=Warning, 2=Error)

Usage:
    python scripts/modbus_simulator.py --port 5020
"""

import argparse
import asyncio
import logging
import random
from pymodbus.server import StartAsyncTcpServer
from pymodbus.device import ModbusDeviceIdentification
from pymodbus.datastore import ModbusSequentialDataBlock, ModbusSlaveContext, ModbusServerContext

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def update_registers(context):
    """
    Background task to update register values with simulated noise.
    """
    logger.info("🚀 Starting register update loop...")
    while True:
        # Register 0: Temperature (20.0 to 30.0 °C -> 200 to 300)
        temp = random.randint(200, 300)
        # Register 1: Pressure (990 to 1030 hPa)
        pressure = random.randint(990, 1030)
        # Register 2: Status (Mostly 0)
        status = 0 if random.random() > 0.05 else random.randint(1, 2)

        # Update unit 1 holding registers (3)
        slave_id = 0x01
        context[slave_id].setValues(3, 0, [temp, pressure, status])
        
        logger.debug(f"📊 Updated registers: Temp={temp/10.0}, Press={pressure}, Status={status}")
        await asyncio.sleep(2)

async def run_server(port):
    """
    Run the Modbus TCP server.
    """
    # Initialize data store (holding registers = 3)
    # We use 100 registers, starting at 0
    store = ModbusSlaveContext(
        hr=ModbusSequentialDataBlock(0, [0] * 100)
    )
    context = ModbusServerContext(slaves=store, single=True)

    # Identity information
    identity = ModbusDeviceIdentification()
    identity.VendorName = 'PeakSoft'
    identity.ProductCode = 'PS-MODBUS-SIM'
    identity.VendorUrl = 'http://peaksoft.io'
    identity.ProductName = 'PeakSoft Modbus Simulator'
    identity.ModelName = 'Virtual IIoT Sensor'
    identity.MajorMinorRevision = '1.0.0'

    logger.info(f"📡 Starting Modbus TCP Server on port {port}...")
    
    # Start updating registers in the background
    asyncio.create_task(update_registers(context))

    # Run the server
    await StartAsyncTcpServer(
        context, 
        identity=identity, 
        address=("0.0.0.0", port)
    )

def main():
    parser = argparse.ArgumentParser(description="Modbus TCP simulator")
    parser.add_argument("--port", type=int, default=5020, help="Port to listen on (default: 5020)")
    args = parser.parse_args()

    try:
        asyncio.run(run_server(args.port))
    except KeyboardInterrupt:
        logger.info("🛑 Server stopped by user")

if __name__ == "__main__":
    main()
