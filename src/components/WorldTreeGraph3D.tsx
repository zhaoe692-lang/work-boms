import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
} from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import { useElementSize } from "../shared/useElementSize";

type FieldVisual = {
  group: Group;
  geometry: MarchingCubes["geometry"];
  wireMaterial: MeshBasicMaterial;
  skinMaterial: MeshBasicMaterial;
};

type CrownSpec = {
  id: string;
  position: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number];
  color: string;
  seed: number;
};

const CROWNS: CrownSpec[] = [
  {
    id: "crown-main",
    position: [0.18, 2.82, -0.58],
    scale: [2.12, 1.5, 1.5],
    rotation: [0.04, -0.16, -0.04],
    color: "#34becb",
    seed: 1,
  },
  {
    id: "crown-left",
    position: [-1.26, 2.26, 0.28],
    scale: [1.76, 1.18, 1.28],
    rotation: [-0.05, 0.18, 0.08],
    color: "#47ced0",
    seed: 2,
  },
  {
    id: "crown-right",
    position: [1.32, 2.32, -0.02],
    scale: [1.62, 1.08, 1.2],
    rotation: [0.06, -0.22, -0.1],
    color: "#2eafc1",
    seed: 3,
  },
  {
    id: "crown-front",
    position: [-0.16, 1.96, 0.82],
    scale: [1.3, 0.86, 0.98],
    rotation: [-0.08, 0.12, 0.05],
    color: "#69d9d2",
    seed: 4,
  },
];

export function WorldTreeGraph3D({ prototype = false }: { prototype?: boolean }) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const controlsRef = useRef<any>(null);
  const [interacting, setInteracting] = useState(false);
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  return (
    <div ref={ref} className={`jarvis-globe-wrap world-tree-wrap ${prototype ? "is-prototype" : ""}`}>
      <div className="graph-canvas-toolbar jarvis-toolbar world-tree-toolbar">
        <div>
          <span className="world-tree-kicker">PROCEDURAL SPECIMEN / 02</span>
          <p className="graph-hint">CROWN STUDY · four independent volumes · drag orbit · wheel zoom</p>
        </div>
        <button type="button" className="tool-btn ghost" onClick={() => controlsRef.current?.reset()}>
          Reset view
        </button>
      </div>

      <div className="jarvis-globe-stage world-tree-stage">
        {size.width > 0 && size.height > 0 && (
          <Canvas
            dpr={[1, 1.7]}
            camera={{ position: [0.2, 0.2, 11.2], fov: 36 }}
            gl={{ antialias: true, alpha: true }}
          >
            <color attach="background" args={["#02080d"]} />
            <fog attach="fog" args={["#02080d", 12, 23]} />
            <SeparatedCrownTree interacting={interacting} reducedMotion={reducedMotion} />
            <OrbitControls
              ref={controlsRef}
              makeDefault
              enablePan
              enableDamping
              dampingFactor={0.075}
              minDistance={7.4}
              maxDistance={18}
              minPolarAngle={Math.PI * 0.2}
              maxPolarAngle={Math.PI * 0.76}
              target={[0, 0.45, 0]}
              onStart={() => setInteracting(true)}
              onEnd={() => setInteracting(false)}
            />
            <EffectComposer multisampling={0}>
              <Bloom luminanceThreshold={0.42} luminanceSmoothing={0.42} intensity={0.52} mipmapBlur />
              <Vignette eskil={false} offset={0.16} darkness={0.66} />
            </EffectComposer>
          </Canvas>
        )}

        <div className="world-tree-readout" aria-hidden="true">
          <span>FORM</span><strong>Separated crown</strong>
          <span>CROWN</span><strong>4 volumes</strong>
          <span>BRANCH</span><strong>Internal only</strong>
        </div>
        <div className="world-tree-axis" aria-hidden="true">
          <span className="axis-y">Y</span>
          <span className="axis-z">Z</span>
          <span className="axis-x">X</span>
        </div>
      </div>
    </div>
  );
}

function SeparatedCrownTree({
  interacting,
  reducedMotion,
}: {
  interacting: boolean;
  reducedMotion: boolean;
}) {
  const rootRef = useRef<Group>(null);
  const crowns = useMemo(() => CROWNS.map(buildCrownField), []);

  useEffect(() => () => {
    crowns.forEach(disposeField);
  }, [crowns]);

  useFrame(({ clock }) => {
    if (!rootRef.current || reducedMotion) return;
    const t = clock.getElapsedTime();
    rootRef.current.rotation.z = Math.sin(t * 0.18) * 0.008;
    if (!interacting) rootRef.current.rotation.y = -0.16 + Math.sin(t * 0.09) * 0.025;
  });

  return (
    <group ref={rootRef} position={[0, -0.32, 0]}>
      <MinimalTrunk />
      {crowns.map((crown, index) => <primitive key={CROWNS[index].id} object={crown.group} />)}
    </group>
  );
}

function MinimalTrunk() {
  return (
    <group position={[0, 0.25, 0]} rotation={[0, 0, -0.018]}>
      <mesh>
        <cylinderGeometry args={[0.18, 0.34, 2.78, 16, 9, false]} />
        <meshBasicMaterial
          color="#31afba"
          wireframe
          transparent
          opacity={0.3}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.178, 0.338, 2.775, 16, 1, false]} />
        <meshBasicMaterial color="#176a75" transparent opacity={0.035} side={DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function buildCrownField(spec: CrownSpec): FieldVisual {
  const visual = createFieldVisual({
    resolution: 42,
    maxPolygons: 90000,
    color: spec.color,
    opacity: spec.id === "crown-front" ? 0.3 : 0.25,
    skinOpacity: spec.id === "crown-front" ? 0.026 : 0.018,
    scale: spec.scale,
    position: spec.position,
    rotation: spec.rotation,
  });
  const surface = visual.group.children[0] as MarchingCubes;
  const drift = (spec.seed - 2.5) * 0.012;
  const balls = [
    [0.25, 0.46 + drift, 0.5, 0.54],
    [0.37, 0.58, 0.43, 0.64],
    [0.51, 0.6 - drift, 0.56, 0.7],
    [0.66, 0.55, 0.45, 0.64],
    [0.76, 0.42 - drift, 0.53, 0.52],
    [0.42, 0.38, 0.59, 0.57],
    [0.58, 0.35 + drift, 0.41, 0.54],
  ] as const;
  surface.reset();
  balls.forEach(([x, y, z, strength]) => surface.addBall(x, y, z, strength, 15.5));
  surface.update();
  return visual;
}

function createFieldVisual(input: {
  resolution: number;
  maxPolygons: number;
  color: string;
  opacity: number;
  skinOpacity: number;
  scale: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
}): FieldVisual {
  const wireMaterial = new MeshBasicMaterial({
    color: input.color,
    transparent: true,
    opacity: input.opacity,
    wireframe: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const surface = new MarchingCubes(input.resolution, wireMaterial, false, false, input.maxPolygons);
  surface.isolation = 80;
  surface.scale.set(...input.scale);
  surface.position.set(...input.position);
  if (input.rotation) surface.rotation.set(...input.rotation);
  surface.frustumCulled = false;

  const skinMaterial = new MeshBasicMaterial({
    color: input.color,
    transparent: true,
    opacity: input.skinOpacity,
    side: DoubleSide,
    depthWrite: false,
  });
  const skin = new Mesh(surface.geometry, skinMaterial);
  skin.scale.copy(surface.scale);
  skin.position.copy(surface.position);
  skin.rotation.copy(surface.rotation);
  skin.frustumCulled = false;

  const group = new Group();
  group.add(surface, skin);
  return { group, geometry: surface.geometry, wireMaterial, skinMaterial };
}

function disposeField(field: FieldVisual) {
  field.geometry.dispose();
  field.wireMaterial.dispose();
  field.skinMaterial.dispose();
}
