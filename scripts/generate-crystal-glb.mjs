import fs from "node:fs";
import path from "node:path";
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class NodeFileReader {
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          this.onloadend?.({ target: this });
        })
        .catch((error) => {
          this.error = error;
          this.onerror?.(error);
        });
    }
  };
}

const outDir = path.resolve("public/models");
const outFile = path.join(outDir, "crystal-cluster.glb");
fs.mkdirSync(outDir, { recursive: true });

const root = new Group();
root.name = "CrystalCluster";

const crystalMaterial = new MeshPhysicalMaterial({
  color: new Color("#78f4de"),
  emissive: new Color("#123b34"),
  emissiveIntensity: 0.25,
  roughness: 0.18,
  metalness: 0,
  transmission: 0.55,
  transparent: true,
  opacity: 0.72,
  thickness: 1.8,
  ior: 1.45,
});

const goldMaterial = new MeshPhysicalMaterial({
  color: new Color("#f4c66e"),
  emissive: new Color("#6d4512"),
  emissiveIntensity: 0.5,
  roughness: 0.22,
  metalness: 0.1,
  transparent: true,
  opacity: 0.86,
});

const anchorMaterial = new MeshPhysicalMaterial({
  color: new Color("#fff3b5"),
  emissive: new Color("#f0b95e"),
  emissiveIntensity: 1.1,
  roughness: 0.3,
});

const edgeMaterial = new LineBasicMaterial({
  color: "#d8fff4",
  transparent: true,
  opacity: 0.32,
});

const anchors = {
  final: [],
  version: [],
  material: [],
  reference: [],
};

function addCrystal(name, position, height, radius, rotationY = 0, material = crystalMaterial) {
  const geometry = createCrystalGeometry(radius, height, 6);
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(position.x, position.y + height / 2, position.z);
  mesh.rotation.y = rotationY;
  root.add(mesh);

  const edges = new LineSegments(new EdgesGeometry(geometry), edgeMaterial);
  edges.name = `${name}_edges`;
  edges.position.copy(mesh.position);
  edges.rotation.copy(mesh.rotation);
  root.add(edges);
  return mesh;
}

function addAnchor(type, index, position) {
  const anchor = new Object3D();
  anchor.name = `anchor_${type}_${String(index).padStart(3, "0")}`;
  anchor.position.copy(position);
  root.add(anchor);
  anchors[type].push(anchor.name);

  if (index < 36 || type === "final") {
    const marker = new Mesh(new SphereGeometry(type === "final" ? 0.18 : 0.07, 12, 12), anchorMaterial);
    marker.name = `marker_${anchor.name}`;
    marker.position.copy(position);
    root.add(marker);
  }
}

const main = addCrystal("main_crystal_final", new Vector3(0, 0, 0), 5.4, 0.72, 0.2, goldMaterial);
addAnchor("final", 0, new Vector3(0, 5.85, 0));

for (let i = 0; i < 12; i += 1) {
  const t = i / 11;
  const y = 0.58 + t * 4.55;
  const angle = -0.85 + t * 1.7;
  const r = 0.9 + Math.sin(t * Math.PI) * 0.35;
  addAnchor("version", i, new Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r));
}

const clusterSpecs = [
  [-2.4, -0.1, -0.8, 2.6, 0.42, -0.35],
  [-1.8, 0.0, 1.3, 2.1, 0.34, 0.45],
  [2.2, 0.0, -1.1, 2.9, 0.46, 0.2],
  [2.8, -0.1, 1.1, 1.9, 0.32, -0.7],
  [-3.3, -0.1, 0.55, 1.65, 0.28, 0.1],
  [3.45, -0.1, 0.1, 1.8, 0.3, 0.65],
  [-0.9, -0.1, -2.2, 1.7, 0.28, -0.15],
  [0.95, -0.1, 2.15, 1.55, 0.27, 0.35],
];

clusterSpecs.forEach((spec, index) => {
  const [x, y, z, h, r, rot] = spec;
  addCrystal(`cluster_crystal_${String(index).padStart(2, "0")}`, new Vector3(x, y, z), h, r, rot);
});

for (let i = 0; i < 180; i += 1) {
  const seed = hash(`material:${i}`);
  const angle = (seed % 6283) / 1000;
  const ring = 1.65 + (seed % 1000) / 1000 * 3.15;
  const sideBias = i % 3 === 0 ? 1.25 : 0.75;
  const x = Math.cos(angle) * ring * sideBias;
  const z = Math.sin(angle) * ring;
  const y = 0.22 + ((seed >> 4) % 1000) / 1000 * (1.15 + ring * 0.38);
  addAnchor("material", i, new Vector3(x, y, z));
}

for (let i = 0; i < 90; i += 1) {
  const seed = hash(`reference:${i}`);
  const angle = (seed % 6283) / 1000;
  const ring = 3.2 + (seed % 1000) / 1000 * 2.35;
  const x = Math.cos(angle) * ring;
  const z = Math.sin(angle) * ring * 0.82;
  const y = 0.12 + ((seed >> 4) % 1000) / 1000 * 1.2;
  addAnchor("reference", i, new Vector3(x, y, z));
}

const base = new Mesh(new CylinderGeometry(4.4, 4.9, 0.1, 48), new MeshPhysicalMaterial({
  color: "#08221f",
  emissive: "#0a302d",
  emissiveIntensity: 0.22,
  roughness: 0.45,
  transparent: true,
  opacity: 0.72,
}));
base.name = "dark_crystal_base";
base.position.y = -0.08;
root.add(base);

root.userData = {
  workbomsCrystalModel: true,
  version: 1,
  anchors,
  notes: "Generated procedural placeholder for GLB + anchor workflow.",
};

const exporter = new GLTFExporter();
const arrayBuffer = await exporter.parseAsync(root, { binary: true });
fs.writeFileSync(outFile, Buffer.from(arrayBuffer));
console.log(outFile);

function createCrystalGeometry(radius, height, sides) {
  const vertices = [];
  const indices = [];
  const lowerY = 0;
  const shoulderY = height * 0.72;
  const topY = height;

  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    const wobble = 0.92 + (i % 2) * 0.12;
    vertices.push(Math.cos(a) * radius * wobble, lowerY, Math.sin(a) * radius * wobble);
  }
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2 + 0.08;
    const wobble = 0.82 + (i % 3) * 0.08;
    vertices.push(Math.cos(a) * radius * 0.74 * wobble, shoulderY, Math.sin(a) * radius * 0.74 * wobble);
  }
  vertices.push(0, topY, 0);
  vertices.push(0, lowerY, 0);
  const topIndex = sides * 2;
  const bottomCenter = topIndex + 1;

  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides;
    indices.push(i, next, sides + next);
    indices.push(i, sides + next, sides + i);
    indices.push(sides + i, sides + next, topIndex);
    indices.push(bottomCenter, next, i);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hash(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 33 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}
