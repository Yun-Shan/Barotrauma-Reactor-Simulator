'use strict';

// Vanilla circuitboxcomponent prefabs, Barotrauma 1.13.5.0. No game assets required.
const catalog = {
  "andcomponent": {
    "className": "AndComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2",
      "set_output"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "equalscomponent": {
    "className": "EqualsComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2",
      "set_output"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "greatercomponent": {
    "className": "GreaterComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2",
      "set_output"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "addercomponent": {
    "className": "AdderComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "colorcomponent": {
    "className": "ColorComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_r",
      "signal_g",
      "signal_b",
      "signal_a"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "subtractcomponent": {
    "className": "SubtractComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "multiplycomponent": {
    "className": "MultiplyComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "dividecomponent": {
    "className": "DivideComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "powcomponent": {
    "className": "ExponentiationComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in",
      "set_exponent"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "orcomponent": {
    "className": "OrComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2",
      "set_output"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "xorcomponent": {
    "className": "XorComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2",
      "set_output"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "notcomponent": {
    "className": "NotComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "concatcomponent": {
    "className": "ConcatComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in1",
      "signal_in2"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "sincomponent": {
    "className": "TrigonometricFunctionComponent",
    "prefabProperties": {
      "function": "Sin"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "coscomponent": {
    "className": "TrigonometricFunctionComponent",
    "prefabProperties": {
      "function": "Cos"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "tancomponent": {
    "className": "TrigonometricFunctionComponent",
    "prefabProperties": {
      "function": "Tan"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "asincomponent": {
    "className": "TrigonometricFunctionComponent",
    "prefabProperties": {
      "function": "Asin"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "acoscomponent": {
    "className": "TrigonometricFunctionComponent",
    "prefabProperties": {
      "function": "Acos"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "atancomponent": {
    "className": "TrigonometricFunctionComponent",
    "prefabProperties": {
      "function": "Atan"
    },
    "inputs": [
      "signal_in",
      "signal_in_x",
      "signal_in_y"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "roundcomponent": {
    "className": "FunctionComponent",
    "prefabProperties": {
      "function": "Round"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "ceilcomponent": {
    "className": "FunctionComponent",
    "prefabProperties": {
      "function": "Ceil"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "floorcomponent": {
    "className": "FunctionComponent",
    "prefabProperties": {
      "function": "Floor"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "factorialcomponent": {
    "className": "FunctionComponent",
    "prefabProperties": {
      "function": "Factorial"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "abscomponent": {
    "className": "FunctionComponent",
    "prefabProperties": {
      "function": "AbsoluteValue"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "squarerootcomponent": {
    "className": "FunctionComponent",
    "prefabProperties": {
      "function": "SquareRoot"
    },
    "inputs": [
      "signal_in"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "modulocomponent": {
    "className": "ModuloComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in",
      "set_modulus"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "relaycomponent": {
    "className": "RelayComponent",
    "prefabProperties": {
      "vulnerabletoemp": "false",
      "canbeoverloaded": "false"
    },
    "inputs": [
      "power_in",
      "signal_in1",
      "signal_in2",
      "toggle",
      "set_state",
      "signal_in3",
      "signal_in4",
      "signal_in5"
    ],
    "outputs": [
      "power_out",
      "signal_out1",
      "signal_out2",
      "state_out",
      "load_value_out",
      "power_value_out",
      "signal_out3",
      "signal_out4",
      "signal_out5"
    ],
    "aliases": {}
  },
  "delaycomponent": {
    "className": "DelayComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in",
      "set_delay"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "memorycomponent": {
    "className": "MemoryComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in",
      "lock_state"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {
      "signal_store": "lock_state"
    }
  },
  "signalcheckcomponent": {
    "className": "SignalCheckComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in",
      "set_output",
      "set_targetsignal"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "regexcomponent": {
    "className": "RegExFindComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in",
      "set_output"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "oscillator": {
    "className": "OscillatorComponent",
    "prefabProperties": {
      "outputtype": "Pulse",
      "frequency": "1"
    },
    "inputs": [
      "set_frequency",
      "set_outputtype"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "wificomponent": {
    "className": "WifiComponent",
    "prefabProperties": {
      "MinChatMessageInterval": "1.0",
      "DiscardDuplicateChatMessages": "true"
    },
    "inputs": [
      "signal_in",
      "set_channel"
    ],
    "outputs": [
      "signal_out"
    ],
    "aliases": {}
  },
  "multiplexercomponent": {
    "className": "MultiplexerComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in0",
      "signal_in1",
      "signal_in2",
      "signal_in3",
      "signal_in4",
      "signal_in5",
      "signal_in6",
      "signal_in7",
      "signal_in8",
      "signal_in9",
      "set_input",
      "move_input"
    ],
    "outputs": [
      "signal_out",
      "selected_input_out"
    ],
    "aliases": {}
  },
  "demultiplexercomponent": {
    "className": "DemultiplexerComponent",
    "prefabProperties": {},
    "inputs": [
      "signal_in",
      "set_output",
      "move_output"
    ],
    "outputs": [
      "signal_out0",
      "signal_out1",
      "signal_out2",
      "signal_out3",
      "signal_out4",
      "signal_out5",
      "signal_out6",
      "signal_out7",
      "signal_out8",
      "signal_out9",
      "selected_output_out"
    ],
    "aliases": {}
  }
};
for (const [prefab, definition] of Object.entries(catalog)) {
  definition.prefab = prefab;
  Object.freeze(definition.inputs); Object.freeze(definition.outputs);
  Object.freeze(definition.prefabProperties); Object.freeze(definition.aliases); Object.freeze(definition);
}
module.exports = Object.freeze(catalog);
